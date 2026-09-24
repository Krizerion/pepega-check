import { ABILITY_COOLDOWNS, classifyAbility } from '../data/ability-catalog';
import { abilityIconUrl } from '../data/wow';
import { CastEvent, ReportAbility, ReportFight } from '../models/wcl';
import { AnalysisInput, Mitigation, SurvivalCd } from './types';

/**
 * The rules for reasoning about whether a raider was protected at a given
 * moment, shared by the death log and the per-mechanic coverage review so both
 * answer the question the same way.
 */

/** Categories that count as "tried to survive". */
export const MITIGATION_CATEGORIES = new Set(['defensive', 'immunity', 'health-pot', 'raid-cd']);

/**
 * How long before a hit a survival cast still counts as covering it.
 *
 * Personals last roughly 6-15s and we never fetch aura events, so any single
 * number is an approximation. It is deliberately generous: a hit is credited as
 * covered whenever something plausibly was still up, because wrongly telling
 * someone they stood in a mechanic naked is worse than missing a mistake.
 */
export const MITIGATION_WINDOW_MS = 12_000;

/** This fight's friendly casts bucketed by caster, each bucket chronological. */
export function castsByPlayer(
  fightId: number,
  input: Pick<AnalysisInput, 'events'>,
): Map<number, CastEvent[]> {
  const byPlayer = new Map<number, CastEvent[]>();
  for (const cast of input.events.get(fightId)?.friendlyCasts ?? []) {
    const bucket = byPlayer.get(cast.sourceID);
    if (bucket) {
      bucket.push(cast);
    } else {
      byPlayer.set(cast.sourceID, [cast]);
    }
  }
  for (const bucket of byPlayer.values()) {
    bucket.sort((a, b) => a.timestamp - b.timestamp);
  }
  return byPlayer;
}

/**
 * The survival abilities each player is known to own, from having pressed them
 * at some point across `fights`. Only spells with a known base cooldown count,
 * so we never speculate about a kit we have not actually seen used.
 */
export function knownKits(
  input: Pick<AnalysisInput, 'events'>,
  fights: readonly ReportFight[],
): Map<number, Set<number>> {
  const kits = new Map<number, Set<number>>();
  for (const fight of fights) {
    for (const cast of input.events.get(fight.id)?.friendlyCasts ?? []) {
      if (!ABILITY_COOLDOWNS[cast.abilityGameID]) {
        continue;
      }
      let kit = kits.get(cast.sourceID);
      if (!kit) {
        kit = new Set();
        kits.set(cast.sourceID, kit);
      }
      kit.add(cast.abilityGameID);
    }
  }
  return kits;
}

/**
 * Which abilities from `kit` were demonstrably off cooldown at `timestamp`,
 * given that player's casts in the fight.
 *
 * Talents that shorten cooldowns are ignored, so this under-reports rather than
 * wrongly accusing someone of sitting on a defensive.
 */
export function readyAt(
  kit: ReadonlySet<number>,
  casts: readonly CastEvent[],
  timestamp: number,
  fightStart: number,
): number[] {
  const lastUse = new Map<number, number>();
  for (const cast of casts) {
    if (cast.timestamp > timestamp) {
      break;
    }
    if (kit.has(cast.abilityGameID)) {
      lastUse.set(cast.abilityGameID, cast.timestamp);
    }
  }

  const ready: number[] = [];
  for (const id of kit) {
    const last = lastUse.get(id);
    const readyFrom = last === undefined ? fightStart : last + ABILITY_COOLDOWNS[id] * 1000;
    if (readyFrom <= timestamp) {
      ready.push(id);
    }
  }
  return ready;
}

/** The player's last survival cast within the window before `timestamp`. */
export function mitigationBefore(
  casts: readonly CastEvent[],
  timestamp: number,
  abilities: ReadonlyMap<number, ReportAbility>,
): Mitigation | null {
  let mitigation: Mitigation | null = null;
  for (const cast of casts) {
    if (cast.timestamp > timestamp) {
      break;
    }
    if (timestamp - cast.timestamp > MITIGATION_WINDOW_MS) {
      continue;
    }
    const ability = abilities.get(cast.abilityGameID);
    const category = classifyAbility(cast.abilityGameID, ability?.name ?? null);
    if (category && MITIGATION_CATEGORIES.has(category)) {
      mitigation = {
        name: ability?.name ?? `#${cast.abilityGameID}`,
        icon: abilityIconUrl(ability?.icon),
        secondsBefore: Math.round((timestamp - cast.timestamp) / 1000),
      };
    }
  }
  return mitigation;
}

/** Names and icons a spell id for display. */
export function describeCd(id: number, abilities: ReadonlyMap<number, ReportAbility>): SurvivalCd {
  const ability = abilities.get(id);
  return { id, name: ability?.name ?? `#${id}`, icon: abilityIconUrl(ability?.icon) };
}

/** Sorted, named survival cooldowns for a list of spell ids. */
export function describeCds(
  ids: readonly number[],
  abilities: ReadonlyMap<number, ReportAbility>,
): SurvivalCd[] {
  return ids.map((id) => describeCd(id, abilities)).sort((a, b) => a.name.localeCompare(b.name));
}
