import { CastEvent, DamageEvent, DeathEvent, DispelEvent, FightEvents } from '../models/wcl';
import { buildAvoidableRows, heuristicAvoidable } from './avoidable';
import { deathCutoff } from './cutoff';
import { aggregateDamage, buildMechanicGroups, phaseAt } from './damage';
import {
  buildDeathLeaderboard,
  buildDeathRows,
  buildDeathSteps,
  buildDeathTimeline,
  buildHpTrace,
  consolidateHealers,
} from './deaths';
import { nextSort, sortRows } from './sort';
import {
  BARKSKIN,
  BOSS_ID,
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

describe('death timelines', () => {
  const rows = buildDeathRows(fight, makeInput());
  const dee = rows[0]; // dies at 60s to Floor Spike

  it('reconstructs the 12s before the death, oldest first', () => {
    // In Dee's window: a spike at 20s is too old; the 60s spike lands on it.
    expect(dee.timeline.map((m) => m.name)).toEqual(['Floor Spike']);
    expect(dee.timeline[0].beforeMs).toBe(0);
  });

  it('interleaves what the player pressed with what hit them', () => {
    // Built directly: no death in the shared fixture happens within 12s of a
    // cast, so going through buildDeathRows would assert nothing.
    const moments = buildDeathTimeline(
      death(60_000, 3, SPIKE),
      { abilities },
      [cast(52_000, 3, BARKSKIN), cast(20_000, 3, BARKSKIN)],
      [hit(55_000, 3, SPIKE, 400), hit(60_000, 3, SPIKE, 900)],
    );
    expect(moments.map((m) => [m.kind, m.name])).toEqual([
      ['cast', 'Barkskin'], // 8s before
      ['damage', 'Floor Spike'], // 5s before
      ['damage', 'Floor Spike'], // the killing blow
    ]);
    // The cast at 20s is 40s before the death, well outside the window.
    expect(moments).toHaveLength(3);
  });

  it('ignores rotational casts, keeping only catalogued abilities', () => {
    const moments = buildDeathTimeline(
      death(60_000, 3, SPIKE),
      { abilities },
      [cast(55_000, 3, 999_999)],
      [],
    );
    expect(moments).toEqual([]);
  });

  it('marks the killing blow', () => {
    expect(dee.timeline.filter((m) => m.fatal)).toHaveLength(1);
    expect(dee.timeline.find((m) => m.fatal)!.name).toBe('Floor Spike');
  });

  it('totals the damage taken in the window', () => {
    expect(dee.damageTaken).toBe(700); // the 60s spike only
  });

  it('positions each moment across the window', () => {
    // The killing blow lands at the death, so it sits at the far end.
    expect(dee.timeline.find((m) => m.fatal)!.pct).toBe(100);
  });

  it('ignores damage from outside the window', () => {
    const eee = rows.find((r) => r.playerName === 'Eee')!;
    // Eee dies at 120s; the only spike on Eee is at 150s, after the death.
    expect(eee.timeline.filter((m) => m.kind === 'damage')).toEqual([]);
  });
});

describe('death timelines: health and healing', () => {
  const MAX = 1_000_000;
  const healers = new Map([
    [2, { name: 'Healy', color: '#0ff' }],
    [4, { name: 'Eee', color: '#f0f' }],
  ]);

  /** Dee takes two hits, gets healed between them, then is chunked from 80%. */
  const moments = () =>
    buildDeathTimeline(
      death(60_000, 3, SPIKE),
      { abilities },
      [],
      [
        hit(52_000, 3, SPIKE, 200_000, { hitPoints: 800_000, maxHitPoints: MAX }),
        hit(56_000, 3, SPIKE, 300_000, { hitPoints: 500_000, maxHitPoints: MAX }),
        // The killing blow: more damage than health left, the rest is overkill.
        hit(60_000, 3, SPIKE, 900_000, { hitPoints: 0, maxHitPoints: MAX, overkill: 100_000 }),
      ],
      [
        {
          timestamp: START + 58_000,
          sourceID: 2,
          targetID: 3,
          abilityGameID: 61295,
          amount: 300_000,
          hitPoints: 800_000,
          maxHitPoints: MAX,
        },
        {
          timestamp: START + 59_000,
          sourceID: 4,
          targetID: 3,
          abilityGameID: 61295,
          amount: 100_000,
          hitPoints: 900_000,
          maxHitPoints: MAX,
        },
      ],
      healers,
    );

  it('reports health either side of every event', () => {
    const first = moments()[0];
    expect(first.hpBefore).toBe(100);
    expect(first.hpAfter).toBe(80);
  });

  it('chains health off the previous reading rather than the arithmetic', () => {
    // The killing blow dealt 900k to someone holding 900k, so
    // `hitPoints + amount` would claim they were at 90% — they were at 90%
    // only because the heal put them there, which is what the chain reports.
    const fatal = moments().find((m) => m.fatal)!;
    expect(fatal.hpBefore).toBe(90);
    expect(fatal.hpAfter).toBe(0);
    expect(fatal.overkill).toBe(100_000);
  });

  it('names who healed, and keeps heals in the sequence', () => {
    const heals = moments().filter((m) => m.kind === 'heal');
    expect(heals.map((m) => m.sourceName)).toEqual(['Healy', 'Eee']);
    expect(heals[0].amount).toBe(300_000);
  });

  it('consolidates healing per healer, not per tick', () => {
    const rows = consolidateHealers([
      ...moments(),
      ...buildDeathTimeline(
        death(60_000, 3, SPIKE),
        { abilities },
        [],
        [],
        [
          {
            timestamp: START + 55_000,
            sourceID: 2,
            targetID: 3,
            abilityGameID: 61295,
            amount: 50_000,
          },
        ],
        healers,
      ),
    ]);
    // Healy: 300k from the first window plus 50k from the second, over 2 casts.
    expect(rows[0]).toEqual(expect.objectContaining({ name: 'Healy', amount: 350_000, casts: 2 }));
    expect(rows[1]).toEqual(expect.objectContaining({ name: 'Eee', amount: 100_000, casts: 1 }));
  });

  it('builds a health trace that ends at zero', () => {
    const { trace, start } = buildHpTrace(moments());
    expect(start).toBe(100);
    expect(trace[trace.length - 1]).toEqual({ x: 100, y: 0 });
    expect(trace.every((point) => point.x >= 0 && point.x <= 100)).toBe(true);
  });

  it('staggers markers that would otherwise be drawn on top of each other', () => {
    const tight = buildDeathTimeline(
      death(60_000, 3, SPIKE),
      { abilities },
      [],
      [
        // Three ticks inside a third of a second: at ~3% of the window each,
        // they would render as one icon without the stagger.
        hit(59_000, 3, SPIKE, 100),
        hit(59_100, 3, SPIKE, 100),
        hit(59_200, 3, SPIKE, 100),
        hit(52_000, 3, SPIKE, 100),
      ],
    );
    const lanes = tight.map((m) => m.lane);
    expect(lanes.slice(1)).toEqual([0, 1, 2]);
    expect(lanes[0]).toBe(0); // far enough away to sit on the baseline
  });

  it('lanes each kind independently, so a heal never shifts a hit', () => {
    const mixed = buildDeathTimeline(
      death(60_000, 3, SPIKE),
      { abilities },
      [],
      [hit(59_000, 3, SPIKE, 100)],
      [{ timestamp: START + 59_050, sourceID: 2, targetID: 3, abilityGameID: 61295, amount: 10 }],
      new Map([[2, { name: 'Healy', color: '#0ff' }]]),
    );
    expect(mixed.every((m) => m.lane === 0)).toBe(true);
  });

  it('leaves health null when the log carried no snapshots', () => {
    const plain = buildDeathTimeline(
      death(60_000, 3, SPIKE),
      { abilities },
      [],
      [hit(58_000, 3, SPIKE, 500)],
    );
    expect(plain[0].hpBefore).toBeNull();
    expect(plain[0].hpAfter).toBeNull();
  });

  it('counts only damage towards the damage taken total', () => {
    const input = makeInput({
      healing: new Map([
        [
          fight.id,
          [
            {
              timestamp: START + 59_000,
              sourceID: 2,
              targetID: 3,
              abilityGameID: 61295,
              amount: 400_000,
            },
          ],
        ],
      ]),
    });
    const dee = buildDeathRows(fight, input).find((r) => r.playerName === 'Dee')!;
    expect(dee.damageTaken).toBe(700); // the 60s spike, not the heal
    expect(dee.healingReceived).toBe(400_000);
    expect(dee.healers.map((h) => h.name)).toEqual(['Healy']);
  });
});

describe('real-log defensiveness and heal folding', () => {
  const heal = (at: number, source: number, amount: number | undefined, ability = 61295) => ({
    timestamp: START + at,
    sourceID: source,
    targetID: 3,
    abilityGameID: ability,
    amount: amount as number,
  });
  const names = new Map([
    [2, { name: 'Healy', color: '#0ff' }],
    [4, { name: 'Eee', color: '#f0f' }],
  ]);

  it('survives events that carry no amount', () => {
    // Warcraft Logs omits `amount` on some entries; `undefined <= 0` is false,
    // so one used to slip through and turn every total into NaN.
    const moments = buildDeathTimeline(
      death(60_000, 3, SPIKE),
      { abilities },
      [],
      [],
      [heal(55_000, 2, undefined), heal(56_000, 2, 5_000)],
      names,
    );
    expect(moments).toHaveLength(1);
    expect(consolidateHealers(moments)[0].amount).toBe(5_000);
  });

  it('keeps a damage event with no amount from poisoning the total', () => {
    const input = makeInput({
      damage: new Map([
        [
          fight.id,
          [
            {
              timestamp: START + 59_000,
              sourceID: BOSS_ID,
              targetID: 3,
              abilityGameID: SPIKE,
              amount: undefined as unknown as number,
            },
            hit(59_500, 3, SPIKE, 400),
          ],
        ],
      ]),
    });
    const dee = buildDeathRows(fight, input).find((r) => r.playerName === 'Dee')!;
    expect(Number.isFinite(dee.damageTaken)).toBe(true);
    expect(dee.damageTaken).toBe(400);
  });

  it('folds a run of heals into one step', () => {
    const moments = buildDeathTimeline(
      death(60_000, 3, SPIKE),
      { abilities },
      [],
      [hit(52_000, 3, SPIKE, 100)],
      [heal(53_000, 2, 1_000), heal(54_000, 4, 2_000), heal(55_000, 2, 3_000)],
      names,
    );
    const steps = buildDeathSteps(moments);
    expect(steps.map((s) => s.kind)).toEqual(['event', 'heals']);
    const group = steps[1].group!;
    expect(group.casts).toBe(3);
    expect(group.amount).toBe(6_000);
    // Grouped by healer and ability, biggest contributor first.
    expect(group.entries.map((e) => [e.healer, e.amount, e.casts])).toEqual([
      ['Healy', 4_000, 2],
      ['Eee', 2_000, 1],
    ]);
  });

  it('splits runs around anything that is not a heal', () => {
    const moments = buildDeathTimeline(
      death(60_000, 3, SPIKE),
      { abilities },
      [],
      [hit(55_000, 3, SPIKE, 100)],
      [
        heal(53_000, 2, 1_000),
        heal(54_000, 2, 1_000),
        heal(56_000, 2, 1_000),
        heal(57_000, 2, 1_000),
      ],
      names,
    );
    expect(buildDeathSteps(moments).map((s) => s.kind)).toEqual(['heals', 'event', 'heals']);
  });

  it('leaves a lone heal as its own line rather than a group of one', () => {
    const moments = buildDeathTimeline(
      death(60_000, 3, SPIKE),
      { abilities },
      [],
      [hit(55_000, 3, SPIKE, 100)],
      [heal(54_000, 2, 1_000)],
      names,
    );
    expect(buildDeathSteps(moments).map((s) => s.kind)).toEqual(['event', 'event']);
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
