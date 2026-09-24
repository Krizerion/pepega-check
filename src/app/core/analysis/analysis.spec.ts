import { CastEvent, DamageEvent, DeathEvent, DispelEvent, FightEvents } from '../models/wcl';
import { buildAvoidableRows, heuristicAvoidable } from './avoidable';
import { deathCutoff } from './cutoff';
import { aggregateDamage, buildMechanicGroups, phaseAt } from './damage';
import { buildDeathLeaderboard, buildDeathRows } from './deaths';
import { nextSort, sortRows } from './sort';
import {
  BARKSKIN,
  CLEANSE,
  ENV_ID,
  FEL_ARMOR,
  HEALTHSTONE,
  RAID_WIDE,
  SHIELD_WALL,
  SPIKE,
  SPIRIT_LINK,
  START,
  TANKBUSTER,
  TEMPERED_POTION,
  abilities,
  actors,
  makeFight,
  players,
  pullEvents,
} from './testing/fixture';
import { AnalysisInput } from './types';
import { buildUtilityRows } from './utility';

// --- fixture -------------------------------------------------------------

const fight = makeFight();
const { cast, hit, death } = pullEvents(START);

const friendlyCasts: CastEvent[] = [
  cast(5_000, 1, SHIELD_WALL), // tank, 240s CD -> still down at 60s
  cast(10_000, 3, BARKSKIN), // druid, 60s CD -> ready again by 80s
  cast(20_000, 2, SPIRIT_LINK),
  cast(30_000, 4, TEMPERED_POTION),
  cast(40_000, 4, HEALTHSTONE),
  cast(50_000, 2, CLEANSE), // dispel cast; the dispel event is what counts
];

const deaths: DeathEvent[] = [
  death(60_000, 3, SPIKE), // Dee: Barkskin used 50s ago (60s CD) -> NOT ready
  death(120_000, 4, RAID_WIDE), // Eee: never used a tracked defensive
  death(260_000, 1, TANKBUSTER), // Tanky: Shield Wall used 255s ago (240s CD) -> ready
];

const events: FightEvents = { friendlyCasts, enemyCasts: [], deaths };

const damage: DamageEvent[] = [
  // Raid-wide: one cast hitting everyone -> not avoidable.
  hit(11_000, 1, RAID_WIDE, 1000),
  hit(11_050, 2, RAID_WIDE, 1000),
  hit(11_100, 3, RAID_WIDE, 1000),
  hit(11_150, 4, RAID_WIDE, 1000),
  // Floor spike: repeated single-target ticks, different people -> avoidable.
  hit(20_000, 3, SPIKE, 500, { absorbed: 100 }),
  hit(60_000, 3, SPIKE, 700),
  hit(150_000, 4, SPIKE, 900),
  // Tankbuster: only ever the tank -> excluded as a tankbuster.
  hit(30_000, 1, TANKBUSTER, 5000),
  hit(90_000, 1, TANKBUSTER, 5000),
  // Player self-damage and environment damage must be ignored entirely.
  { timestamp: START + 25_000, sourceID: 3, targetID: 3, abilityGameID: FEL_ARMOR, amount: 250 },
  { timestamp: START + 26_000, sourceID: ENV_ID, targetID: 4, abilityGameID: SPIKE, amount: 400 },
];

const dispels: DispelEvent[] = [
  { timestamp: START + 50_100, sourceID: 2, targetID: 3, abilityGameID: CLEANSE, isBuff: false },
  { timestamp: START + 250_000, sourceID: 2, targetID: 4, abilityGameID: CLEANSE, isBuff: false },
];

function makeInput(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    fights: [fight],
    players,
    abilities,
    actors,
    events: new Map([[fight.id, events]]),
    damage: new Map([[fight.id, damage]]),
    dispels: new Map([[fight.id, dispels]]),
    ignoreAfterDeaths: null,
    ...overrides,
  };
}

// --- tests ---------------------------------------------------------------

describe('deathCutoff', () => {
  const input = makeInput();

  it('is off when the setting is null', () => {
    expect(deathCutoff(fight, input.events, null)).toBeNull();
  });

  it('returns the timestamp of the Nth death', () => {
    expect(deathCutoff(fight, input.events, 1)).toBe(START + 60_000);
    expect(deathCutoff(fight, input.events, 2)).toBe(START + 120_000);
  });

  it('is off when the fight never reached N deaths', () => {
    expect(deathCutoff(fight, input.events, 9)).toBeNull();
  });
});

describe('phaseAt', () => {
  it('maps timestamps onto phase transitions', () => {
    expect(phaseAt(fight, START)).toBe(1);
    expect(phaseAt(fight, START + 50_000)).toBe(1);
    expect(phaseAt(fight, START + 100_000)).toBe(2);
    expect(phaseAt(fight, START + 250_000)).toBe(2);
  });
});

describe('aggregateDamage', () => {
  it('counts only NPC-sourced damage on raiders', () => {
    const { byAbility } = aggregateDamage(makeInput(), false);
    expect(byAbility.has(FEL_ARMOR)).toBe(false); // player self-damage
    expect(byAbility.get(SPIKE)!.hits).toBe(3); // the environment tick is excluded
  });

  it('excludes absorbed damage unless asked for it', () => {
    expect(aggregateDamage(makeInput(), false).byAbility.get(SPIKE)!.total).toBe(2100);
    expect(aggregateDamage(makeInput(), true).byAbility.get(SPIKE)!.total).toBe(2200);
  });

  it('clusters hits into casts so repeated mechanics are not over-counted', () => {
    const { byAbility } = aggregateDamage(makeInput(), false);
    // Four raid-wide hits land within 150ms → one cast.
    expect(byAbility.get(RAID_WIDE)!.occurrences).toBe(1);
    // Three spikes, far apart → three casts.
    expect(byAbility.get(SPIKE)!.occurrences).toBe(3);
  });

  it('splits damage across phases', () => {
    const { byPhase } = aggregateDamage(makeInput(), false);
    expect(byPhase.get(1)!.has(RAID_WIDE)).toBe(true);
    expect(byPhase.get(2)!.get(SPIKE)!.hits).toBe(1); // only the 150s spike
  });

  it('stops at the death cutoff', () => {
    const { byAbility } = aggregateDamage(makeInput({ ignoreAfterDeaths: 1 }), false);
    // Cutoff is the first death at 60s, so the 150s spike is dropped.
    expect(byAbility.get(SPIKE)!.hits).toBe(2);
  });
});

describe('buildMechanicGroups', () => {
  it('labels phases and sorts mechanics alphabetically', () => {
    const input = makeInput();
    const groups = buildMechanicGroups(input, aggregateDamage(input, false));
    expect(groups.map((g) => g.label)).toEqual(['Phase 1', 'Phase 2']);
    const names = groups[0].mechanics.map((m) => m.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('reports players hit and average hit per mechanic', () => {
    const input = makeInput();
    const groups = buildMechanicGroups(input, aggregateDamage(input, false));
    const raidWide = groups[0].mechanics.find((m) => m.id === RAID_WIDE)!;
    expect(raidWide.playersHit).toBe(4);
    expect(raidWide.totalDamage).toBe(4000);
    expect(raidWide.avgHit).toBe(1000);
  });
});

describe('heuristicAvoidable', () => {
  const input = makeInput();
  const flagged = heuristicAvoidable(aggregateDamage(input, false), input);

  it('flags mechanics that only catch a few people per cast', () => {
    expect(flagged.has(SPIKE)).toBe(true);
  });

  it('does not flag raid-wide damage', () => {
    expect(flagged.has(RAID_WIDE)).toBe(false);
  });

  it('does not flag tank-only damage', () => {
    expect(flagged.has(TANKBUSTER)).toBe(false);
  });
});

describe('buildAvoidableRows', () => {
  it('totals flagged damage per player and averages it per pull', () => {
    const input = makeInput();
    const rows = buildAvoidableRows(input, aggregateDamage(input, false), (id) => id === SPIKE);
    const dee = rows.find((r) => r.name === 'Dee')!;
    expect(dee.damage).toBe(1200); // 500 + 700
    expect(dee.hits).toBe(2);
    expect(dee.perPull).toBe(1200); // one pull in scope
    expect(rows.find((r) => r.name === 'Tanky')).toBeUndefined();
  });

  it('scales bars against the worst raider', () => {
    const input = makeInput();
    const rows = buildAvoidableRows(input, aggregateDamage(input, false), (id) => id === SPIKE);
    expect(Math.max(...rows.map((r) => r.pct))).toBe(100);
  });
});

describe('buildDeathRows', () => {
  const input = makeInput();
  const rows = buildDeathRows(fight, input);

  it('lists deaths chronologically with the killing ability', () => {
    expect(rows.map((r) => r.playerName)).toEqual(['Dee', 'Eee', 'Tanky']);
    expect(rows[2].abilityName).toBe('Big Smack');
  });

  it('finds a defensive pressed shortly before death', () => {
    // Dee used Barkskin 50s before dying, outside the 12s mitigation window.
    expect(rows[0].mitigation).toBeNull();
  });

  it('only reports cooldowns that were genuinely ready', () => {
    const dee = rows[0];
    const tanky = rows[2];
    // Barkskin (60s CD) was used 50s earlier → not ready.
    expect(dee.available.map((a) => a.name)).not.toContain('Barkskin');
    // Shield Wall (240s CD) was used 255s earlier → ready again.
    expect(tanky.available.map((a) => a.name)).toContain('Shield Wall');
  });

  it('ignores abilities the player never demonstrated they have', () => {
    // Eee only ever used consumables, which carry no cooldown entry.
    expect(rows[1].available).toEqual([]);
  });

  it('respects the death cutoff', () => {
    const cut = buildDeathRows(fight, makeInput({ ignoreAfterDeaths: 1 }));
    expect(cut).toHaveLength(1);
  });
});

describe('buildDeathLeaderboard', () => {
  it('counts deaths and unmitigated deaths per player', () => {
    const board = buildDeathLeaderboard(makeInput());
    expect(board.every((row) => row.deaths === 1)).toBe(true);
    expect(board.every((row) => row.unmitigated === 1)).toBe(true);
  });
});

describe('buildUtilityRows', () => {
  const rows = buildUtilityRows(makeInput());
  const by = (name: string) => rows.find((r) => r.name === name)!;

  it('orders tanks, then healers, then dps', () => {
    expect(rows.map((r) => r.name)).toEqual(['Tanky', 'Healy', 'Dee', 'Eee']);
  });

  it('counts each kind of activity separately', () => {
    expect(by('Tanky').defensives).toBe(1); // Shield Wall
    expect(by('Healy').raidCds).toBe(1); // Spirit Link
    expect(by('Eee').combatPots).toBe(1);
    expect(by('Eee').healthPots).toBe(1);
  });

  it('counts successful dispels rather than dispel casts', () => {
    expect(by('Healy').dispels).toBe(2);
  });

  it('counts deaths', () => {
    expect(by('Dee').deaths).toBe(1);
    expect(by('Healy').deaths).toBe(0);
  });

  it('honours the death cutoff', () => {
    const cut = buildUtilityRows(makeInput({ ignoreAfterDeaths: 1 }));
    // The second dispel happens at 250s, well past the first death at 60s.
    expect(cut.find((r) => r.name === 'Healy')!.dispels).toBe(1);
  });
});

describe('sortRows / nextSort', () => {
  const rows = [
    { name: 'b', value: 2 },
    { name: 'a', value: 10 },
    { name: 'c', value: null as number | null },
  ];

  it('sorts strings alphabetically and numbers numerically', () => {
    expect(sortRows(rows, { key: 'name', dir: 1 }).map((r) => r.name)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, { key: 'value', dir: -1 }).map((r) => r.value)).toEqual([10, 2, null]);
  });

  it('flips direction on the same column and defaults sensibly on a new one', () => {
    expect(nextSort({ key: 'value', dir: -1 }, 'value')).toEqual({ key: 'value', dir: 1 });
    expect(nextSort({ key: 'value', dir: -1 }, 'name')).toEqual({ key: 'name', dir: 1 });
    expect(nextSort({ key: 'name', dir: 1 }, 'value')).toEqual({ key: 'value', dir: -1 });
  });
});
