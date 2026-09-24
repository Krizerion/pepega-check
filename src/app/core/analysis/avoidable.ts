import { abilityIconUrl, classColor } from '../data/wow';
import {
  AnalysisInput,
  AvoidableMechanic,
  AvoidableRow,
  DamageAggregate,
  wowheadSpellUrl,
} from './types';

/**
 * A mechanic is treated as avoidable by default when a single cast of it hits
 * fewer than this share of the raid on average — raid-wide damage is
 * unavoidable, a few people eating it usually is not.
 */
export const AVOIDABLE_RAID_SHARE = 0.5;

/**
 * Abilities the heuristic flags as avoidable, before any user override.
 * Tank-only mechanics are excluded as tankbusters.
 */
export function heuristicAvoidable(
  aggregate: DamageAggregate,
  input: Pick<AnalysisInput, 'players'>,
): Set<number> {
  const tanks = new Set(input.players.filter((p) => p.role === 'tank').map((p) => p.id));
  const raidSize = Math.max(1, input.players.length);
  const flagged = new Set<number>();

  for (const [id, agg] of aggregate.byAbility) {
    const hitIds = [...agg.byPlayer.keys()];
    const tankOnly = hitIds.length > 0 && hitIds.every((playerId) => tanks.has(playerId));
    // How many raiders a single cast catches on average.
    const perCast = agg.hits / Math.max(1, agg.occurrences);
    if (!tankOnly && perCast < raidSize * AVOIDABLE_RAID_SHARE) {
      flagged.add(id);
    }
  }
  return flagged;
}

/** Avoidable damage taken per raider, broken down by mechanic. */
export function buildAvoidableRows(
  input: AnalysisInput,
  aggregate: DamageAggregate,
  isAvoidable: (abilityId: number) => boolean,
): AvoidableRow[] {
  const pullCount = Math.max(1, input.fights.length);
  const perPlayer = new Map<
    number,
    { damage: number; hits: number; mechanics: AvoidableMechanic[] }
  >();

  for (const [id, agg] of aggregate.byAbility) {
    if (!isAvoidable(id)) {
      continue;
    }
    const ability = input.abilities.get(id);
    for (const [playerId, stats] of agg.byPlayer) {
      const entry = perPlayer.get(playerId) ?? { damage: 0, hits: 0, mechanics: [] };
      entry.damage += stats.damage;
      entry.hits += stats.hits;
      entry.mechanics.push({
        id,
        name: ability?.name ?? `Ability #${id}`,
        icon: abilityIconUrl(ability?.icon),
        url: wowheadSpellUrl(id),
        damage: stats.damage,
        hits: stats.hits,
        pct: 0,
      });
      perPlayer.set(playerId, entry);
    }
  }

  const rows = input.players
    .filter((player) => perPlayer.has(player.id))
    .map((player) => {
      const entry = perPlayer.get(player.id)!;
      const mechanics = entry.mechanics.sort((a, b) => b.damage - a.damage);
      const worst = mechanics[0]?.damage ?? 1;
      for (const mechanic of mechanics) {
        mechanic.pct = Math.max(2, Math.round((mechanic.damage / worst) * 100));
      }
      return {
        name: player.name,
        color: classColor(player.className),
        damage: entry.damage,
        hits: entry.hits,
        perPull: entry.damage / pullCount,
        pct: 0,
        mechanics,
      };
    });

  const max = Math.max(1, ...rows.map((r) => r.damage));
  for (const row of rows) {
    row.pct = Math.round((row.damage / max) * 100);
  }
  return rows;
}
