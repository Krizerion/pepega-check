import { ABILITY_COOLDOWNS, classifyAbility } from '../data/ability-catalog';
import { abilityIconUrl, classColor } from '../data/wow';
import { DeathEvent, ReportFight, killingAbilityId } from '../models/wcl';
import { deathCutoff, isAfterCutoff } from './cutoff';
import { AnalysisInput, DeathRow, LeaderboardRow, wowheadSpellUrl } from './types';

/** Categories that count as "tried to survive" right before a death. */
export const MITIGATION_CATEGORIES = new Set(['defensive', 'immunity', 'health-pot', 'raid-cd']);
export const MITIGATION_WINDOW_MS = 12_000;

/** The last survival attempt by the dying player shortly before their death. */
export function findMitigation(
  death: DeathEvent,
  fight: ReportFight,
  input: Pick<AnalysisInput, 'abilities' | 'events'>,
): DeathRow['mitigation'] {
  let mitigation: DeathRow['mitigation'] = null;
  for (const cast of input.events.get(fight.id)?.friendlyCasts ?? []) {
    if (cast.sourceID !== death.targetID) {
      continue;
    }
    if (cast.timestamp > death.timestamp) {
      break;
    }
    if (death.timestamp - cast.timestamp > MITIGATION_WINDOW_MS) {
      continue;
    }
    const ability = input.abilities.get(cast.abilityGameID);
    const category = classifyAbility(cast.abilityGameID, ability?.name ?? null);
    if (category && MITIGATION_CATEGORIES.has(category)) {
      mitigation = {
        name: ability?.name ?? `#${cast.abilityGameID}`,
        icon: abilityIconUrl(ability?.icon),
        secondsBefore: Math.round((death.timestamp - cast.timestamp) / 1000),
      };
    }
  }
  return mitigation;
}

/**
 * Survival abilities the player demonstrably had off cooldown when they died:
 * something they used at some point across `knownFrom` (so we know they have
 * it) whose last cast before the death was longer ago than its cooldown.
 *
 * Only spells with a known base cooldown are considered, and cooldown-reducing
 * talents are ignored, so this under-reports rather than wrongly accusing.
 */
export function findAvailable(
  death: DeathEvent,
  fight: ReportFight,
  input: Pick<AnalysisInput, 'abilities' | 'events'>,
  knownFrom: readonly ReportFight[],
): DeathRow['available'] {
  const known = new Set<number>();
  for (const pull of knownFrom) {
    for (const cast of input.events.get(pull.id)?.friendlyCasts ?? []) {
      if (cast.sourceID === death.targetID && ABILITY_COOLDOWNS[cast.abilityGameID]) {
        known.add(cast.abilityGameID);
      }
    }
  }
  if (known.size === 0) {
    return [];
  }

  const lastUse = new Map<number, number>();
  for (const cast of input.events.get(fight.id)?.friendlyCasts ?? []) {
    if (cast.sourceID === death.targetID && cast.timestamp <= death.timestamp) {
      lastUse.set(cast.abilityGameID, cast.timestamp);
    }
  }

  const available: DeathRow['available'] = [];
  for (const id of known) {
    const last = lastUse.get(id);
    const readyAt = last === undefined ? fight.startTime : last + ABILITY_COOLDOWNS[id] * 1000;
    if (readyAt <= death.timestamp) {
      const ability = input.abilities.get(id);
      available.push({ id, name: ability?.name ?? `#${id}`, icon: abilityIconUrl(ability?.icon) });
    }
  }
  return available.sort((a, b) => a.name.localeCompare(b.name));
}

/** Chronological death log for one fight. */
export function buildDeathRows(
  fight: ReportFight,
  input: AnalysisInput,
  knownFrom: readonly ReportFight[] = input.fights,
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
    .filter((death) => !isAfterCutoff(death.timestamp, cutoff))
    .map((death) => {
      const player = playersById.get(death.targetID);
      const abilityId = killingAbilityId(death);
      const killer = abilityId !== null ? input.abilities.get(abilityId) : null;
      const killerActor = death.killerID != null ? actorsById.get(death.killerID) : null;

      return {
        timeMs: death.timestamp - fight.startTime,
        playerId: death.targetID,
        playerName: player?.name ?? `#${death.targetID}`,
        playerColor: player ? classColor(player.className) : 'var(--text-1)',
        abilityName:
          killer?.name ?? (killerActor ? `${killerActor.name} (melee/unknown)` : 'Unknown'),
        abilityIcon: abilityIconUrl(killer?.icon),
        abilityUrl: abilityId !== null && abilityId > 1 ? wowheadSpellUrl(abilityId) : null,
        mitigation: findMitigation(death, fight, input),
        available: findAvailable(death, fight, input, knownFrom),
      };
    });
}

/** Deaths per player across the scope, with how many had nothing pressed. */
export function buildDeathLeaderboard(input: AnalysisInput): LeaderboardRow[] {
  const rows = new Map<number, LeaderboardRow>();
  for (const fight of input.fights) {
    for (const death of buildDeathRows(fight, input)) {
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
