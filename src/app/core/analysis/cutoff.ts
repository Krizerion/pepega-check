import { FightEvents, ReportFight } from '../models/wcl';

/**
 * Absolute timestamp of the Nth death in a fight — the point past which the
 * "ignore after N deaths" setting stops counting events. Returns null when the
 * setting is off or the fight never reached that many deaths.
 */
export function deathCutoff(
  fight: ReportFight,
  events: ReadonlyMap<number, FightEvents>,
  ignoreAfterDeaths: number | null,
): number | null {
  if (ignoreAfterDeaths === null) {
    return null;
  }
  const deaths = events.get(fight.id)?.deaths;
  if (!deaths || deaths.length < ignoreAfterDeaths) {
    return null;
  }
  const sorted = [...deaths].sort((a, b) => a.timestamp - b.timestamp);
  return sorted[ignoreAfterDeaths - 1].timestamp;
}

/** True when the event happened after the fight's cutoff and should be skipped. */
export function isAfterCutoff(timestamp: number, cutoff: number | null): boolean {
  return cutoff !== null && timestamp > cutoff;
}
