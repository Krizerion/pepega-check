import { DeathEvent, FightEvents, ReportFight } from '../models/wcl';
import { buildPhaseWipeRows, phaseWipeHeadline } from './phases';
import {
  RAID_WIDE,
  SPIKE,
  START,
  TANKBUSTER,
  abilities,
  actors,
  makeFight,
  players,
  pullEvents,
} from './testing/fixture';
import { AnalysisInput } from './types';

// --- fixture -------------------------------------------------------------

/** Four pulls: one dies in P1, two die in P2, the last one kills. */
const GAP = 1_000_000;

function pull(id: number, over: Partial<ReportFight>): ReportFight {
  return makeFight({ id, startTime: START + id * GAP, ...over });
}

const wipeP1 = pull(1, { endTime: START + GAP + 60_000, lastPhase: 1 });
// makeFight always adds a P2 transition, so a P1 wipe has to drop it.
wipeP1.phaseTransitions = [{ id: 1, startTime: wipeP1.startTime }];

const wipeP2a = pull(2, { endTime: START + 2 * GAP + 150_000 });
const wipeP2b = pull(3, { endTime: START + 3 * GAP + 170_000 });
const kill = pull(4, { endTime: START + 4 * GAP + 200_000, kill: true });

const fights = [wipeP1, wipeP2a, wipeP2b, kill];

function deathsIn(fight: ReportFight, spec: [number, number, number][]): DeathEvent[] {
  const { death } = pullEvents(fight.startTime);
  return spec.map(([at, target, ability]) => death(at, target, ability));
}

const events = new Map<number, FightEvents>([
  [
    wipeP1.id,
    {
      friendlyCasts: [],
      enemyCasts: [],
      deaths: deathsIn(wipeP1, [
        [30_000, 3, SPIKE],
        [40_000, 4, SPIKE],
      ]),
    },
  ],
  [
    wipeP2a.id,
    {
      friendlyCasts: [],
      enemyCasts: [],
      deaths: deathsIn(wipeP2a, [
        [120_000, 1, TANKBUSTER],
        [130_000, 3, RAID_WIDE],
      ]),
    },
  ],
  [
    wipeP2b.id,
    {
      friendlyCasts: [],
      enemyCasts: [],
      deaths: deathsIn(wipeP2b, [
        [140_000, 3, RAID_WIDE],
        [160_000, 4, RAID_WIDE],
      ]),
    },
  ],
  [kill.id, { friendlyCasts: [], enemyCasts: [], deaths: [] }],
]);

function makeInput(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    fights,
    players,
    abilities,
    actors,
    events,
    damage: new Map(),
    dispels: new Map(),
    ignoreAfterDeaths: null,
    ...overrides,
  };
}

// --- tests ---------------------------------------------------------------

describe('buildPhaseWipeRows', () => {
  const rows = buildPhaseWipeRows(makeInput());
  const phase = (n: number) => rows.find((r) => r.phase === n)!;

  it('counts pulls that entered, cleared and died in each phase', () => {
    expect(phase(1).reached).toBe(4);
    expect(phase(1).cleared).toBe(3); // everyone but the P1 wipe got through
    expect(phase(1).wipes).toBe(1);

    expect(phase(2).reached).toBe(3);
    expect(phase(2).cleared).toBe(1); // only the kill
    expect(phase(2).wipes).toBe(2);
  });

  it('attributes deaths to the phase they happened in', () => {
    expect(phase(1).deaths).toBe(2);
    expect(phase(2).deaths).toBe(4);
    expect(phase(2).deathsPerPull).toBeCloseTo(4 / 3);
  });

  it('names the deadliest abilities per phase, most deaths first', () => {
    expect(phase(1).killers.map((k) => k.name)).toEqual(['Floor Spike']);
    expect(phase(2).killers.map((k) => [k.name, k.deaths])).toEqual([
      ['Raid Wide Nuke', 3],
      ['Big Smack', 1],
    ]);
  });

  it('reports the window holding the middle half of a phase deaths', () => {
    // P2 deaths at 120s, 130s, 140s, 160s.
    expect(phase(2).window).toEqual({ fromMs: 130_000, toMs: 140_000 });
  });

  it('reports the median time the wipes in a phase happened', () => {
    expect(phase(1).medianWipeMs).toBe(60_000);
    expect(phase(2).medianWipeMs).toBe(170_000);
  });

  it('scales bars against the deadliest phase', () => {
    expect(phase(1).pct).toBe(50);
    expect(phase(2).pct).toBe(100);
  });

  it('stays silent for single-phase encounters', () => {
    const single = makeFight({ id: 9, lastPhase: 1, phaseTransitions: [] });
    expect(buildPhaseWipeRows(makeInput({ fights: [single] }))).toEqual([]);
  });

  it('honours the death cutoff', () => {
    const cut = buildPhaseWipeRows(makeInput({ ignoreAfterDeaths: 1 }));
    // Only the first death of each pull survives the cutoff.
    expect(cut.find((r) => r.phase === 1)!.deaths).toBe(1);
    expect(cut.find((r) => r.phase === 2)!.deaths).toBe(2);
  });
});

describe('phaseWipeHeadline', () => {
  const rows = buildPhaseWipeRows(makeInput());

  it('names the phase that is costing the night', () => {
    expect(phaseWipeHeadline(rows)).toBe(
      'Phase 2 is the wall: 2 of 3 wipes end there, usually around 2:50, most often to Raid Wide Nuke.',
    );
  });

  it('says nothing when no phase has wiped the raid twice', () => {
    expect(phaseWipeHeadline([rows[0]])).toBeNull();
  });

  it('names no wall when wipes are spread evenly', () => {
    const tied = rows.map((row) => ({ ...row, wipes: 2 }));
    expect(phaseWipeHeadline(tied)).toBeNull();
  });
});
