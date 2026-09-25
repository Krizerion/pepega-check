import { RAID_BUFFS, isAugmentRune, isFlask, isFood } from '../data/ability-catalog';
import { abilityIconUrl, classColor } from '../data/wow';
import { CombatantAura, CombatantInfoEvent, ReportFight } from '../models/wcl';
import {
  AnalysisInput,
  ReadinessBuff,
  ReadinessItem,
  ReadinessReport,
  ReadinessRow,
} from './types';

/**
 * What the raid turned up with.
 *
 * Flasks, food, runes and raid buffs are auras carried into the pull, not casts
 * made during it, so none of this is visible anywhere else in the app — it
 * comes from the combatant-info snapshot Warcraft Logs takes as a fight starts.
 */
export function buildReadiness(
  fight: ReportFight,
  input: Pick<AnalysisInput, 'players' | 'abilities'>,
  combatantInfo: readonly CombatantInfoEvent[],
): ReadinessReport {
  const byPlayer = new Map<number, CombatantInfoEvent>();
  for (const event of combatantInfo) {
    byPlayer.set(event.sourceID, event);
  }

  const rows: ReadinessRow[] = [];
  const absent: { name: string; color: string }[] = [];
  /** Raid buffs seen on anyone: a buff nobody has is a raid-wide gap. */
  const seenSomewhere = new Set<number>();

  for (const player of input.players) {
    const info = byPlayer.get(player.id);
    const color = classColor(player.className);

    if (!info) {
      // No snapshot means they were not in this pull at all.
      absent.push({ name: player.name, color });
      continue;
    }

    const auras = info.auras ?? [];
    for (const aura of auras) {
      if (RAID_BUFFS.some((buff) => buff.id === aura.ability)) {
        seenSomewhere.add(aura.ability);
      }
    }

    const missingBuffs = RAID_BUFFS.filter(
      (buff) => !auras.some((aura) => aura.ability === buff.id),
    ).map((buff) => ({ id: buff.id, label: buff.label, name: buff.name }));

    rows.push({
      playerId: player.id,
      name: player.name,
      color,
      role: player.role,
      flask: findAura(auras, input, isFlask),
      food: findAura(auras, input, isFood),
      rune: findAura(auras, input, isAugmentRune),
      missingBuffs,
    });
  }

  /*
   * A buff nobody in the raid has is reported once, at the top, rather than as
   * a missing buff against all twenty raiders: usually it means the class that
   * brings it did not come, which is a roster fact and not twenty mistakes.
   */
  const rosterClasses = new Set(input.players.map((p) => p.className));
  const raidWideGaps: ReadinessBuff[] = RAID_BUFFS.filter(
    (buff) => !seenSomewhere.has(buff.id),
  ).map((buff) => ({
    id: buff.id,
    label: buff.label,
    name: buff.name,
    /** True when nobody present could have cast it anyway. */
    nobodyBrings: !rosterClasses.has(buff.from),
  }));

  const gapIds = new Set(raidWideGaps.map((buff) => buff.id));
  for (const row of rows) {
    row.missingBuffs = row.missingBuffs.filter((buff) => !gapIds.has(buff.id));
  }

  rows.sort(
    (a, b) => score(a) - score(b) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name),
  );

  return {
    fightId: fight.id,
    rows,
    absent,
    raidWideGaps,
    counts: {
      total: rows.length,
      flask: rows.filter((r) => r.flask).length,
      food: rows.filter((r) => r.food).length,
      rune: rows.filter((r) => r.rune).length,
    },
  };
}

/** Worst-prepared first: that is the only part of the table anyone reads. */
function score(row: ReadinessRow): number {
  return (
    (row.flask ? 1 : 0) + (row.food ? 1 : 0) + (row.rune ? 1 : 0) - row.missingBuffs.length * 0.5
  );
}

function findAura(
  auras: readonly CombatantAura[],
  input: Pick<AnalysisInput, 'abilities'>,
  matches: (name: string | null) => boolean,
): ReadinessItem | null {
  for (const aura of auras) {
    const name = aura.name ?? input.abilities.get(aura.ability)?.name ?? null;
    if (matches(name)) {
      return {
        abilityId: aura.ability,
        name: name ?? `Aura #${aura.ability}`,
        icon: abilityIconUrl(input.abilities.get(aura.ability)?.icon),
      };
    }
  }
  return null;
}
