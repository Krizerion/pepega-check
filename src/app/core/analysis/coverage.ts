import { classColor } from '../data/wow';
import { killingAbilityId } from '../models/wcl';
import { deathCutoff, isAfterCutoff } from './cutoff';
import { OCCURRENCE_GAP_MS, isMechanicHit, npcSourceIds } from './damage';
import {
  castsByPlayer,
  describeCd,
  describeCds,
  knownKits,
  mitigationBefore,
  readyAt,
} from './survival';
import {
  AnalysisInput,
  CoverageGroup,
  CoverageInstance,
  CoverageRow,
  wowheadSpellUrl,
} from './types';

/**
 * Mechanic-anchored cooldown review: instead of asking "did you press something
 * before you died", ask "for each cast of this mechanic that caught you, were
 * you covered — and if not, what was off cooldown at that moment".
 *
 * That turns a post-mortem into a habit to fix. A raider who eats Toxic
 * Droplets nine times with Barkskin available for six of them has something to
 * change whether or not any of those hits killed them.
 */

/** How many mechanics to review, ranked by total damage dealt to the raid. */
export const COVERAGE_MECHANIC_LIMIT = 8;

/** A mechanic needs at least this many instances to be worth reviewing. */
const MIN_INSTANCES = 2;

/** A death this soon after a mechanic's last tick is attributed to it. */
const FATAL_TOLERANCE_MS = 1_000;

const MAX_SUGGESTIONS = 3;

interface Cell {
  abilityId: number;
  playerId: number;
  instances: CoverageInstance[];
  damage: number;
  covered: number;
  missed: number;
  deaths: number;
  /** How often each cooldown was available while uncovered. */
  readyCounts: Map<number, number>;
}

interface Cluster {
  start: number;
  end: number;
  damage: number;
}

/**
 * Per-mechanic coverage for every raider the mechanic hit.
 *
 * Ticks of one mechanic on one player closer together than `OCCURRENCE_GAP_MS`
 * count as a single instance, so standing in a puddle is one decision rather
 * than twenty.
 */
export function buildCoverageGroups(
  input: AnalysisInput,
  includeAbsorbed: boolean,
  limit = COVERAGE_MECHANIC_LIMIT,
): CoverageGroup[] {
  const playersById = new Map(input.players.map((p) => [p.id, p]));
  const playerIds = new Set(playersById.keys());
  const npcSources = npcSourceIds(input);
  const kits = knownKits(input, input.fights);

  const cells = new Map<string, Cell>();
  const abilityDamage = new Map<number, number>();

  input.fights.forEach((fight, index) => {
    const cutoff = deathCutoff(fight, input.events, input.ignoreAfterDeaths);
    const casts = castsByPlayer(fight.id, input);
    const pull = input.pullNumber?.get(fight.id) ?? index + 1;

    // Deaths keyed by killing ability + victim, to mark which instance was fatal.
    const fatalities = new Map<string, number[]>();
    for (const death of input.events.get(fight.id)?.deaths ?? []) {
      const abilityId = killingAbilityId(death);
      if (abilityId === null) {
        continue;
      }
      const key = `${abilityId}:${death.targetID}`;
      const times = fatalities.get(key);
      if (times) {
        times.push(death.timestamp);
      } else {
        fatalities.set(key, [death.timestamp]);
      }
    }

    const clusters = new Map<string, Cluster[]>();
    const ticks = [...(input.damage.get(fight.id) ?? [])].sort((a, b) => a.timestamp - b.timestamp);
    for (const event of ticks) {
      if (!isMechanicHit(event, playerIds, npcSources)) {
        continue;
      }
      if (isAfterCutoff(event.timestamp, cutoff)) {
        continue;
      }
      const amount = event.amount + (includeAbsorbed ? (event.absorbed ?? 0) : 0);
      abilityDamage.set(
        event.abilityGameID,
        (abilityDamage.get(event.abilityGameID) ?? 0) + amount,
      );

      const key = `${event.abilityGameID}:${event.targetID}`;
      const list = clusters.get(key);
      if (!list) {
        clusters.set(key, [{ start: event.timestamp, end: event.timestamp, damage: amount }]);
        continue;
      }
      const last = list[list.length - 1];
      if (event.timestamp - last.end <= OCCURRENCE_GAP_MS) {
        last.end = event.timestamp;
        last.damage += amount;
      } else {
        list.push({ start: event.timestamp, end: event.timestamp, damage: amount });
      }
    }

    for (const [key, list] of clusters) {
      const [abilityId, playerId] = key.split(':').map(Number);
      const mine = casts.get(playerId) ?? [];
      const kit = kits.get(playerId) ?? new Set<number>();

      let cell = cells.get(key);
      if (!cell) {
        cell = {
          abilityId,
          playerId,
          instances: [],
          damage: 0,
          covered: 0,
          missed: 0,
          deaths: 0,
          readyCounts: new Map(),
        };
        cells.set(key, cell);
      }

      for (const cluster of list) {
        // The decision is made before the first tick lands.
        const mitigation = mitigationBefore(mine, cluster.start, input.abilities);
        const ready = readyAt(kit, mine, cluster.start, fight.startTime);
        const fatal = (fatalities.get(key) ?? []).some(
          (at) => at >= cluster.start && at <= cluster.end + FATAL_TOLERANCE_MS,
        );

        cell.instances.push({
          fightId: fight.id,
          pull,
          atMs: cluster.start - fight.startTime,
          damage: cluster.damage,
          mitigation,
          ready: describeCds(ready, input.abilities),
          fatal,
        });
        cell.damage += cluster.damage;
        if (mitigation) {
          cell.covered++;
        } else {
          if (ready.length > 0) {
            cell.missed++;
          }
          for (const id of ready) {
            cell.readyCounts.set(id, (cell.readyCounts.get(id) ?? 0) + 1);
          }
        }
        if (fatal) {
          cell.deaths++;
        }
      }
    }
  });

  const rowsByAbility = new Map<number, CoverageRow[]>();
  for (const cell of cells.values()) {
    const player = playersById.get(cell.playerId);
    const hits = cell.instances.length;
    const row: CoverageRow = {
      key: `${cell.abilityId}:${cell.playerId}`,
      abilityId: cell.abilityId,
      playerId: cell.playerId,
      name: player?.name ?? `#${cell.playerId}`,
      color: player ? classColor(player.className) : 'var(--text-1)',
      hits,
      covered: cell.covered,
      missed: cell.missed,
      damage: cell.damage,
      deaths: cell.deaths,
      pct: Math.round((cell.covered / Math.max(1, hits)) * 100),
      suggestions: [...cell.readyCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_SUGGESTIONS)
        .map(([id, times]) => ({ ...describeCd(id, input.abilities), times })),
      instances: cell.instances.sort((a, b) => a.pull - b.pull || a.atMs - b.atMs),
    };
    const bucket = rowsByAbility.get(cell.abilityId);
    if (bucket) {
      bucket.push(row);
    } else {
      rowsByAbility.set(cell.abilityId, [row]);
    }
  }

  return [...rowsByAbility.entries()]
    .map(([abilityId, rows]): CoverageGroup => {
      const ability = input.abilities.get(abilityId);
      const hits = rows.reduce((sum, row) => sum + row.hits, 0);
      const covered = rows.reduce((sum, row) => sum + row.covered, 0);
      return {
        abilityId,
        name: ability?.name ?? `Ability #${abilityId}`,
        icon: describeCd(abilityId, input.abilities).icon,
        url: wowheadSpellUrl(abilityId),
        hits,
        covered,
        pct: Math.round((covered / Math.max(1, hits)) * 100),
        damage: abilityDamage.get(abilityId) ?? 0,
        deaths: rows.reduce((sum, row) => sum + row.deaths, 0),
        rows: rows.sort((a, b) => b.missed - a.missed || b.damage - a.damage),
      };
    })
    .filter((group) => group.hits >= MIN_INSTANCES)
    .sort((a, b) => b.damage - a.damage)
    .slice(0, limit);
}
