import { CATEGORY_META, classifyAbility } from '../data/ability-catalog';
import { abilityIconUrl, classColor } from '../data/wow';
import { CastEvent, DamageEvent, DeathEvent, ReportFight, killingAbilityId } from '../models/wcl';
import { deathCutoff, isAfterCutoff } from './cutoff';
import { isMechanicHit, npcSourceIds } from './damage';
import {
  MITIGATION_WINDOW_MS,
  castsByPlayer,
  describeCds,
  knownKits,
  mitigationBefore,
  readyAt,
} from './survival';
import { AnalysisInput, DeathMoment, DeathRow, LeaderboardRow, wowheadSpellUrl } from './types';

/**
 * Reconstructs the run-up to a death: every mechanic that hit the player and
 * everything they pressed, across the window before they died.
 *
 * The killing blow on its own is the least interesting part of a death — it is
 * usually just the last tick of something that had been going wrong for ten
 * seconds. The sequence is what tells you whether they were chunked from full,
 * ground down while a defensive sat ready, or already doomed when they pressed.
 */
export function buildDeathTimeline(
  death: DeathEvent,
  input: Pick<AnalysisInput, 'abilities'>,
  casts: readonly CastEvent[],
  hits: readonly DamageEvent[],
): DeathMoment[] {
  const from = death.timestamp - MITIGATION_WINDOW_MS;
  const killer = killingAbilityId(death);
  const moments: DeathMoment[] = [];

  for (const hit of hits) {
    if (hit.timestamp <= from || hit.timestamp > death.timestamp) {
      continue;
    }
    const ability = input.abilities.get(hit.abilityGameID);
    moments.push({
      beforeMs: death.timestamp - hit.timestamp,
      kind: 'damage',
      abilityId: hit.abilityGameID,
      name: ability?.name ?? `Ability #${hit.abilityGameID}`,
      icon: abilityIconUrl(ability?.icon),
      url: hit.abilityGameID > 1 ? wowheadSpellUrl(hit.abilityGameID) : null,
      amount: hit.amount,
      fatal: false,
      color: null,
      pct: 0,
    });
  }

  for (const cast of casts) {
    if (cast.timestamp <= from || cast.timestamp > death.timestamp) {
      continue;
    }
    const ability = input.abilities.get(cast.abilityGameID);
    // Only catalogued abilities: the rest is rotational noise at this zoom.
    const category = classifyAbility(cast.abilityGameID, ability?.name ?? null);
    if (!category) {
      continue;
    }
    moments.push({
      beforeMs: death.timestamp - cast.timestamp,
      kind: 'cast',
      abilityId: cast.abilityGameID,
      name: ability?.name ?? `#${cast.abilityGameID}`,
      icon: abilityIconUrl(ability?.icon),
      url: wowheadSpellUrl(cast.abilityGameID),
      amount: 0,
      fatal: false,
      color: CATEGORY_META.get(category)?.color ?? null,
      pct: 0,
    });
  }

  moments.sort((a, b) => b.beforeMs - a.beforeMs);

  // The killing blow is the last hit of the ability Warcraft Logs blames.
  for (let i = moments.length - 1; i >= 0; i--) {
    const moment = moments[i];
    if (moment.kind === 'damage' && (killer === null || moment.abilityId === killer)) {
      moment.fatal = true;
      break;
    }
  }

  for (const moment of moments) {
    moment.pct = Math.round(
      ((MITIGATION_WINDOW_MS - moment.beforeMs) / MITIGATION_WINDOW_MS) * 100,
    );
  }
  return moments;
}

/** Chronological death log for one fight, given precomputed player indexes. */
function deathRows(
  fight: ReportFight,
  input: AnalysisInput,
  casts: ReadonlyMap<number, CastEvent[]>,
  kits: ReadonlyMap<number, Set<number>>,
  hits: ReadonlyMap<number, DamageEvent[]>,
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
      const timeline = buildDeathTimeline(death, input, mine, hits.get(death.targetID) ?? []);

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
        timeline,
        damageTaken: timeline.reduce((sum, moment) => sum + moment.amount, 0),
      };
    });
}

/** Boss damage taken by each raider in one fight, chronological. */
function hitsByPlayer(fight: ReportFight, input: AnalysisInput): Map<number, DamageEvent[]> {
  const players = new Set(input.players.map((p) => p.id));
  const npcSources = npcSourceIds(input);
  const byPlayer = new Map<number, DamageEvent[]>();

  for (const event of input.damage.get(fight.id) ?? []) {
    if (!isMechanicHit(event, players, npcSources)) {
      continue;
    }
    const bucket = byPlayer.get(event.targetID);
    if (bucket) {
      bucket.push(event);
    } else {
      byPlayer.set(event.targetID, [event]);
    }
  }
  for (const bucket of byPlayer.values()) {
    bucket.sort((a, b) => a.timestamp - b.timestamp);
  }
  return byPlayer;
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
  return deathRows(
    fight,
    input,
    castsByPlayer(fight.id, input),
    knownKits(input, knownFrom),
    hitsByPlayer(fight, input),
  );
}

/** Deaths per player across the scope, with how many had nothing pressed. */
export function buildDeathLeaderboard(input: AnalysisInput): LeaderboardRow[] {
  const kits = knownKits(input, input.fights);
  const rows = new Map<number, LeaderboardRow>();

  for (const fight of input.fights) {
    for (const death of deathRows(
      fight,
      input,
      castsByPlayer(fight.id, input),
      kits,
      hitsByPlayer(fight, input),
    )) {
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
