import { CastEvent, DamageEvent, DeathEvent, FightEvents } from '../models/wcl';
import { buildCoverageGroups } from './coverage';
import {
  BARKSKIN,
  RAID_WIDE,
  SHIELD_WALL,
  SPIKE,
  START,
  TANKBUSTER,
  abilities,
  actors,
  makeFight,
  players,
  pullEvents,
} from './testing/fixture';
import { AnalysisInput, CoverageGroup } from './types';

// --- fixture -------------------------------------------------------------

const PULL_TWO_START = START + 1_000_000;

const one = makeFight({ id: 1, startTime: START });
const two = makeFight({ id: 2, startTime: PULL_TWO_START });

const first = pullEvents(START);
const second = pullEvents(PULL_TWO_START);

const firstCasts: CastEvent[] = [
  first.cast(5_000, 1, SHIELD_WALL), // Tanky, 240s CD
  first.cast(18_000, 3, BARKSKIN), // Dee, 60s CD -> ready again at 78s
];

const firstDeaths: DeathEvent[] = [
  first.death(90_500, 3, SPIKE), // Dee, right after the 90s spike
  first.death(200_400, 4, SPIKE), // Eee, right after the 200s spike
];

const firstDamage: DamageEvent[] = [
  first.hit(20_000, 3, SPIKE, 500, { absorbed: 100 }), // 2s after Barkskin -> covered
  first.hit(60_000, 3, SPIKE, 700), // Barkskin still on cooldown
  first.hit(90_000, 3, SPIKE, 900), // Barkskin ready again -> missed, and fatal
  // Three ticks inside the cluster gap: one decision, not three.
  first.hit(30_000, 4, SPIKE, 100),
  first.hit(30_800, 4, SPIKE, 100),
  first.hit(31_400, 4, SPIKE, 100),
  first.hit(200_000, 4, SPIKE, 1000), // fatal
  first.hit(40_000, 1, TANKBUSTER, 5000), // the only instance all night
];

// Second pull: one raid-wide cast, which only Dee pressed anything for.
const secondCasts: CastEvent[] = [second.cast(5_000, 3, BARKSKIN)];
const secondDamage: DamageEvent[] = players.map((p) => second.hit(10_000, p.id, RAID_WIDE, 2000));

const events = new Map<number, FightEvents>([
  [one.id, { friendlyCasts: firstCasts, enemyCasts: [], deaths: firstDeaths }],
  [two.id, { friendlyCasts: secondCasts, enemyCasts: [], deaths: [] }],
]);

function makeInput(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    fights: [one, two],
    players,
    abilities,
    actors,
    events,
    damage: new Map([
      [one.id, firstDamage],
      [two.id, secondDamage],
    ]),
    dispels: new Map(),
    ignoreAfterDeaths: null,
    ...overrides,
  };
}

const groupFor = (groups: CoverageGroup[], abilityId: number) =>
  groups.find((g) => g.abilityId === abilityId);

const rowFor = (groups: CoverageGroup[], abilityId: number, name: string) =>
  groupFor(groups, abilityId)!.rows.find((r) => r.name === name)!;

// --- tests ---------------------------------------------------------------

describe('buildCoverageGroups', () => {
  const groups = buildCoverageGroups(makeInput(), false);

  it('treats ticks inside the cluster gap as a single decision', () => {
    // Eee took three spike ticks within 1.4s, plus one much later.
    expect(rowFor(groups, SPIKE, 'Eee').hits).toBe(2);
  });

  it('credits a defensive pressed shortly before the hit', () => {
    const dee = rowFor(groups, SPIKE, 'Dee');
    expect(dee.hits).toBe(3);
    expect(dee.covered).toBe(1);
    expect(dee.instances[0].mitigation?.name).toBe('Barkskin');
    expect(dee.instances[0].mitigation?.secondsBefore).toBe(2);
  });

  it('counts an uncovered hit as missed only when something was ready', () => {
    const dee = rowFor(groups, SPIKE, 'Dee');
    // 60s hit: Barkskin still down. 90s hit: back up and unused.
    expect(dee.missed).toBe(1);
    expect(dee.suggestions).toEqual([
      expect.objectContaining({ id: BARKSKIN, name: 'Barkskin', times: 1 }),
    ]);
  });

  it('never invents a kit for a player we have not seen press anything', () => {
    const eee = rowFor(groups, SPIKE, 'Eee');
    expect(eee.covered).toBe(0);
    expect(eee.missed).toBe(0);
    expect(eee.suggestions).toEqual([]);
  });

  it('learns a kit from every pull in scope', () => {
    // Tanky only ever pressed Shield Wall in pull 1, but it counts as his in
    // pull 2, where it had not been used and so was available.
    const tanky = rowFor(groups, RAID_WIDE, 'Tanky');
    expect(tanky.missed).toBe(1);
    expect(tanky.suggestions[0].id).toBe(SHIELD_WALL);
  });

  it('marks the instance that killed the player', () => {
    const dee = rowFor(groups, SPIKE, 'Dee');
    expect(dee.deaths).toBe(1);
    expect(dee.instances.map((i) => i.fatal)).toEqual([false, false, true]);
  });

  it('aggregates coverage across the raid per mechanic', () => {
    const raidWide = groupFor(groups, RAID_WIDE)!;
    expect(raidWide.hits).toBe(4); // one cast, four raiders
    expect(raidWide.covered).toBe(1); // only Dee pressed anything
    expect(raidWide.pct).toBe(25);
  });

  it('drops mechanics with too few instances to review', () => {
    expect(groupFor(groups, TANKBUSTER)).toBeUndefined();
  });

  it('ranks mechanics by damage and honours the limit', () => {
    expect(groups.map((g) => g.abilityId)).toEqual([RAID_WIDE, SPIKE]);
    expect(buildCoverageGroups(makeInput(), false, 1).map((g) => g.abilityId)).toEqual([RAID_WIDE]);
  });

  it('counts absorbed damage only when asked', () => {
    expect(rowFor(groups, SPIKE, 'Dee').damage).toBe(2100);
    expect(rowFor(buildCoverageGroups(makeInput(), true), SPIKE, 'Dee').damage).toBe(2200);
  });

  it('labels instances with their pull number', () => {
    const numbered = buildCoverageGroups(makeInput({ pullNumber: new Map([[one.id, 6]]) }), false);
    expect(rowFor(numbered, SPIKE, 'Dee').instances[0].pull).toBe(6);
    // Pull 2 has no entry, so it falls back to its position in the scope.
    expect(rowFor(numbered, RAID_WIDE, 'Dee').instances[0].pull).toBe(2);
  });

  it('respects the death cutoff', () => {
    const cut = buildCoverageGroups(makeInput({ ignoreAfterDeaths: 1 }), false);
    // Pull 1's first death is at 90.5s, so Eee's 200s spike is out of scope.
    const eee = rowFor(cut, SPIKE, 'Eee');
    expect(eee.hits).toBe(1);
    expect(eee.deaths).toBe(0);
  });
});
