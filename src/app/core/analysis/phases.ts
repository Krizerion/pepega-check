import { abilityIconUrl } from '../data/wow';
import { ReportFight, fightDuration, formatOffset, killingAbilityId } from '../models/wcl';
import { deathCutoff, isAfterCutoff } from './cutoff';
import { phaseAt } from './damage';
import { AnalysisInput, PhaseKiller, PhaseWipeRow, wowheadSpellUrl } from './types';

/**
 * Where pulls end, aggregated across the scope.
 *
 * A pull-by-pull view answers "what killed us this time"; this answers the
 * question a raid actually plans around — which phase is costing the night, how
 * far into the fight it goes wrong, and what does the killing there.
 */

/** How many killing abilities to name per phase. */
const MAX_KILLERS = 3;

/** A phase needs this many wipes before it is called out as the blocker. */
const HEADLINE_MIN_WIPES = 2;

function bump(counts: Map<number, number>, key: number): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function push(lists: Map<number, number[]>, key: number, value: number): void {
  const list = lists.get(key);
  if (list) {
    list.push(value);
  } else {
    lists.set(key, [value]);
  }
}

/** Value at the given quantile of an ascending list. */
function quantile(ascending: readonly number[], q: number): number {
  const index = Math.round((ascending.length - 1) * q);
  return ascending[Math.min(ascending.length - 1, Math.max(0, index))];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );
}

/**
 * The phases a pull entered, and the one it ended in.
 *
 * Phase transitions are the reliable signal; `lastPhase` fills in for reports
 * that carry it without transitions. WoW numbers an encounter's phases
 * sequentially from 1, so every phase up to the last is treated as entered.
 */
function phasesOf(fight: ReportFight): { reached: number[]; endPhase: number } {
  const ids = (fight.phaseTransitions ?? []).map((t) => t.id);
  const endPhase = Math.max(1, fight.lastPhase ?? 1, ...ids);
  const reached: number[] = [];
  for (let phase = 1; phase <= endPhase; phase++) {
    reached.push(phase);
  }
  return { reached, endPhase };
}

/**
 * Per-phase progress and death breakdown across the scope.
 *
 * Returns an empty list for single-phase encounters, where the breakdown would
 * just restate the death log.
 */
export function buildPhaseWipeRows(input: AnalysisInput): PhaseWipeRow[] {
  const reachedCount = new Map<number, number>();
  const clearedCount = new Map<number, number>();
  const wipeCount = new Map<number, number>();
  const deathTimes = new Map<number, number[]>();
  const wipeTimes = new Map<number, number[]>();
  const killers = new Map<number, Map<number, number>>();
  let maxPhase = 1;

  for (const fight of input.fights) {
    const transitions = [...(fight.phaseTransitions ?? [])].sort(
      (a, b) => a.startTime - b.startTime,
    );
    const sorted: ReportFight = { ...fight, phaseTransitions: transitions };
    const { reached, endPhase } = phasesOf(fight);
    maxPhase = Math.max(maxPhase, endPhase);

    for (const phase of reached) {
      bump(reachedCount, phase);
      if (phase < endPhase || fight.kill) {
        bump(clearedCount, phase);
      }
    }
    if (!fight.kill) {
      bump(wipeCount, endPhase);
      push(wipeTimes, endPhase, fightDuration(fight));
    }

    const cutoff = deathCutoff(fight, input.events, input.ignoreAfterDeaths);
    for (const death of input.events.get(fight.id)?.deaths ?? []) {
      if (isAfterCutoff(death.timestamp, cutoff)) {
        continue;
      }
      const phase = phaseAt(sorted, death.timestamp);
      push(deathTimes, phase, death.timestamp - fight.startTime);

      const abilityId = killingAbilityId(death);
      if (abilityId === null) {
        continue;
      }
      let byAbility = killers.get(phase);
      if (!byAbility) {
        byAbility = new Map();
        killers.set(phase, byAbility);
      }
      bump(byAbility, abilityId);
    }
  }

  if (maxPhase < 2) {
    return [];
  }

  const rows: PhaseWipeRow[] = [];
  for (let phase = 1; phase <= maxPhase; phase++) {
    const reached = reachedCount.get(phase) ?? 0;
    if (reached === 0) {
      continue;
    }
    const times = [...(deathTimes.get(phase) ?? [])].sort((a, b) => a - b);
    const topKillers: PhaseKiller[] = [...(killers.get(phase) ?? new Map())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KILLERS)
      .map(([id, deaths]) => {
        const ability = input.abilities.get(id);
        return {
          id,
          name: ability?.name ?? `Ability #${id}`,
          icon: abilityIconUrl(ability?.icon),
          url: id > 1 ? wowheadSpellUrl(id) : null,
          deaths,
        };
      });

    rows.push({
      phase,
      name: `Phase ${phase}`,
      reached,
      cleared: clearedCount.get(phase) ?? 0,
      wipes: wipeCount.get(phase) ?? 0,
      deaths: times.length,
      deathsPerPull: times.length / reached,
      // The middle half of this phase's deaths, which is the window to plan for.
      window:
        times.length >= 2 ? { fromMs: quantile(times, 0.25), toMs: quantile(times, 0.75) } : null,
      medianWipeMs: median(wipeTimes.get(phase) ?? []),
      killers: topKillers,
      pct: 0,
    });
  }

  const worst = Math.max(1, ...rows.map((row) => row.deaths));
  for (const row of rows) {
    row.pct = Math.round((row.deaths / worst) * 100);
  }
  return rows;
}

/**
 * One-line verdict on which phase is blocking progress.
 *
 * Returns null unless one phase ends strictly more pulls than every other: with
 * wipes spread evenly there is no wall to name, and picking the top of a tie
 * would invent a conclusion the table below does not support.
 */
export function phaseWipeHeadline(rows: readonly PhaseWipeRow[]): string | null {
  // On a tie the later phase ranks first, being the deeper blocker.
  const ranked = [...rows].sort((a, b) => b.wipes - a.wipes || b.phase - a.phase);
  const [worst, runnerUp] = ranked;
  if (!worst || worst.wipes < HEADLINE_MIN_WIPES) {
    return null;
  }
  if (runnerUp && runnerUp.wipes >= worst.wipes) {
    return null;
  }
  const total = rows.reduce((sum, row) => sum + row.wipes, 0);
  const when =
    worst.medianWipeMs !== null ? `, usually around ${formatOffset(worst.medianWipeMs)}` : '';
  const killer = worst.killers[0];
  const blame = killer ? `, most often to ${killer.name}` : '';
  return `${worst.name} is the wall: ${worst.wipes} of ${total} wipes end there${when}${blame}.`;
}
