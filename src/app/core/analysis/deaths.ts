import { abilityIconUrl, classColor } from '../data/wow';
import { CastEvent, DeathEvent, ReportFight, killingAbilityId } from '../models/wcl';
import { deathCutoff, isAfterCutoff } from './cutoff';
import { castsByPlayer, describeCds, knownKits, mitigationBefore, readyAt } from './survival';
import { AnalysisInput, DeathRow, LeaderboardRow, wowheadSpellUrl } from './types';

/** Chronological death log for one fight, given precomputed player indexes. */
function deathRows(
  fight: ReportFight,
  input: AnalysisInput,
  casts: ReadonlyMap<number, CastEvent[]>,
  kits: ReadonlyMap<number, Set<number>>,
): DeathRow[] {
  const events = input.events.get(fight.id);
  if (!events) {
    return [];
  }
  const cutoff = deathCutoff(fight, input.events, input.ignoreAfterDeaths);
  const playersById = new Map(input.players.map((p) => [p.id, p]));
  const actorsById = new Map(input.actors.map((a) => [a.id, a]));

  return [...events.deaths]
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((death: DeathEvent) => !isAfterCutoff(death.timestamp, cutoff))
    .map((death) => {
      const player = playersById.get(death.targetID);
      const abilityId = killingAbilityId(death);
      const killer = abilityId !== null ? input.abilities.get(abilityId) : null;
      const killerActor = death.killerID != null ? actorsById.get(death.killerID) : null;
      const mine = casts.get(death.targetID) ?? [];
      const kit = kits.get(death.targetID) ?? new Set<number>();

      return {
        timeMs: death.timestamp - fight.startTime,
        playerId: death.targetID,
        playerName: player?.name ?? `#${death.targetID}`,
        playerColor: player ? classColor(player.className) : 'var(--text-1)',
        abilityName:
          killer?.name ?? (killerActor ? `${killerActor.name} (melee/unknown)` : 'Unknown'),
        abilityIcon: abilityIconUrl(killer?.icon),
        abilityUrl: abilityId !== null && abilityId > 1 ? wowheadSpellUrl(abilityId) : null,
        mitigation: mitigationBefore(mine, death.timestamp, input.abilities),
        available: describeCds(
          readyAt(kit, mine, death.timestamp, fight.startTime),
          input.abilities,
        ),
      };
    });
}

/**
 * Chronological death log for one fight.
 *
 * `knownFrom` is where a player's kit is learned: pass every pull, because
 * whether someone owns Barkskin cannot be told from the pull they died in.
 */
export function buildDeathRows(
  fight: ReportFight,
  input: AnalysisInput,
  knownFrom: readonly ReportFight[] = input.fights,
): DeathRow[] {
  return deathRows(fight, input, castsByPlayer(fight.id, input), knownKits(input, knownFrom));
}

/** Deaths per player across the scope, with how many had nothing pressed. */
export function buildDeathLeaderboard(input: AnalysisInput): LeaderboardRow[] {
  const kits = knownKits(input, input.fights);
  const rows = new Map<number, LeaderboardRow>();

  for (const fight of input.fights) {
    for (const death of deathRows(fight, input, castsByPlayer(fight.id, input), kits)) {
      let row = rows.get(death.playerId);
      if (!row) {
        row = { name: death.playerName, color: death.playerColor, deaths: 0, unmitigated: 0 };
        rows.set(death.playerId, row);
      }
      row.deaths++;
      if (!death.mitigation) {
        row.unmitigated++;
      }
    }
  }
  return [...rows.values()].sort((a, b) => b.deaths - a.deaths || b.unmitigated - a.unmitigated);
}
