import { isBattleRez, isLust } from '../data/ability-catalog';
import { abilityIconUrl, classColor } from '../data/wow';
import { CastEvent, ReportFight } from '../models/wcl';
import { deathCutoff, isAfterCutoff } from './cutoff';
import { AnalysisInput, RaidCooldownUse, RaidCooldowns, wowheadSpellUrl } from './types';

/**
 * Who pressed the raid-wide cooldowns, and when.
 *
 * Both answers come out of the cast stream the timeline already loads, so this
 * costs no extra requests — which matters, because the rest of this session is
 * about asking Warcraft Logs for less, not more.
 */
export function buildRaidCooldowns(input: AnalysisInput): RaidCooldowns {
  const lust: RaidCooldownUse[] = [];
  const battleRez: RaidCooldownUse[] = [];

  const players = new Map(input.players.map((p) => [p.id, p]));
  const actors = new Map(input.actors.map((a) => [a.id, a]));

  /**
   * Resolves a caster to a raider.
   *
   * A hunter's Primal Rage is cast by the pet, not the hunter, so crediting the
   * source id directly would attribute the raid's lust to "Bloodpaw" and leave
   * the hunter looking like they did nothing.
   */
  const casterOf = (sourceId: number) => {
    const direct = players.get(sourceId);
    if (direct) {
      return { name: direct.name, color: classColor(direct.className), pet: null };
    }
    const actor = actors.get(sourceId);
    const owner = actor?.petOwner != null ? players.get(actor.petOwner) : undefined;
    if (owner) {
      return { name: owner.name, color: classColor(owner.className), pet: actor?.name ?? null };
    }
    // An item or an unknown actor: drums used by someone not in the roster.
    return { name: actor?.name ?? 'Unknown', color: 'var(--text-1)', pet: null };
  };

  const targetOf = (cast: CastEvent): string | null => {
    if (cast.targetID == null) {
      return null;
    }
    return players.get(cast.targetID)?.name ?? actors.get(cast.targetID)?.name ?? null;
  };

  for (const fight of input.fights) {
    const cutoff = deathCutoff(fight, input.events, input.ignoreAfterDeaths);

    for (const cast of input.events.get(fight.id)?.friendlyCasts ?? []) {
      if (isAfterCutoff(cast.timestamp, cutoff)) {
        continue;
      }
      const ability = input.abilities.get(cast.abilityGameID);
      const name = ability?.name ?? null;
      const lustHit = isLust(cast.abilityGameID, name);
      const rezHit = !lustHit && isBattleRez(cast.abilityGameID, name);
      if (!lustHit && !rezHit) {
        continue;
      }

      const caster = casterOf(cast.sourceID);
      const use: RaidCooldownUse = {
        fightId: fight.id,
        timeMs: cast.timestamp - fight.startTime,
        abilityId: cast.abilityGameID,
        abilityName: name ?? `Ability #${cast.abilityGameID}`,
        icon: abilityIconUrl(ability?.icon),
        url: cast.abilityGameID > 1 ? wowheadSpellUrl(cast.abilityGameID) : null,
        casterName: caster.name,
        casterColor: caster.color,
        viaPet: caster.pet,
        targetName: rezHit ? targetOf(cast) : null,
      };
      (lustHit ? lust : battleRez).push(use);
    }
  }

  const chronological = (a: RaidCooldownUse, b: RaidCooldownUse) =>
    a.fightId - b.fightId || a.timeMs - b.timeMs;
  lust.sort(chronological);
  battleRez.sort(chronological);

  return { lust, battleRez, byCaster: countByCaster(battleRez) };
}

/** Battle rezzes per raider, most first — the "who is carrying the pool" view. */
function countByCaster(
  uses: readonly RaidCooldownUse[],
): { name: string; color: string; count: number }[] {
  const counts = new Map<string, { name: string; color: string; count: number }>();
  for (const use of uses) {
    const entry = counts.get(use.casterName);
    if (entry) {
      entry.count++;
    } else {
      counts.set(use.casterName, { name: use.casterName, color: use.casterColor, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Pulls in the scope that never saw the haste buff at all. */
export function pullsWithoutLust(
  fights: readonly ReportFight[],
  lust: readonly RaidCooldownUse[],
): number[] {
  const used = new Set(lust.map((use) => use.fightId));
  return fights.filter((f) => !used.has(f.id)).map((f) => f.id);
}
