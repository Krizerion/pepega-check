import { abilityIconUrl, classColor } from '../data/wow';
import { DamageEvent, PlayerInfo, ReportFight } from '../models/wcl';
import { deathCutoff, isAfterCutoff } from './cutoff';
import {
  Agg,
  AnalysisInput,
  DamageAggregate,
  MechanicRow,
  PhaseGroup,
  wowheadSpellUrl,
} from './types';

/** Hits of one ability closer together than this belong to the same cast. */
export const OCCURRENCE_GAP_MS = 1_500;

const emptyAgg = (): Agg => ({ hits: 0, total: 0, byPlayer: new Map(), occurrences: 0 });

/** Enemy actors whose damage counts as a boss mechanic. */
export function npcSourceIds(input: Pick<AnalysisInput, 'actors'>): Set<number> {
  return new Set(
    input.actors.filter((a) => a.type === 'NPC' && a.name !== 'Environment').map((a) => a.id),
  );
}

/**
 * Whether a damage tick is a boss mechanic landing on a raider.
 *
 * Player self-damage (Fel Armor, trinket runes) and environment effects are
 * excluded. Shared with the coverage review so both agree on what a hit is.
 */
export function isMechanicHit(
  event: DamageEvent,
  players: ReadonlySet<number>,
  npcSources: ReadonlySet<number>,
): boolean {
  return (
    event.abilityGameID > 1 &&
    players.has(event.targetID) &&
    event.sourceID !== null &&
    npcSources.has(event.sourceID)
  );
}

function record(agg: Agg, targetId: number, amount: number): void {
  agg.hits++;
  agg.total += amount;
  const player = agg.byPlayer.get(targetId) ?? { damage: 0, hits: 0 };
  player.damage += amount;
  player.hits++;
  agg.byPlayer.set(targetId, player);
}

/** Which phase a timestamp falls into, given a fight's phase transitions. */
export function phaseAt(fight: ReportFight, timestamp: number): number {
  let phase = 1;
  for (const transition of fight.phaseTransitions ?? []) {
    if (transition.startTime <= timestamp) {
      phase = transition.id;
    }
  }
  return phase;
}

/**
 * Single pass over the damage-taken events in scope, aggregated per phase and
 * (phase-independently) per ability.
 */
export function aggregateDamage(input: AnalysisInput, includeAbsorbed: boolean): DamageAggregate {
  const byPhase = new Map<number, Map<number, Agg>>();
  const byAbility = new Map<number, Agg>();
  let sawTransitions = false;

  const players = new Set(input.players.map((p) => p.id));
  const npcSources = npcSourceIds(input);

  for (const fight of input.fights) {
    const cutoff = deathCutoff(fight, input.events, input.ignoreAfterDeaths);
    const transitions = [...(fight.phaseTransitions ?? [])].sort(
      (a, b) => a.startTime - b.startTime,
    );
    if (transitions.length > 1) {
      sawTransitions = true;
    }
    const sorted: ReportFight = { ...fight, phaseTransitions: transitions };
    // Last hit timestamp per ability, to split hits into distinct casts.
    const lastHitAt = new Map<number, number>();

    for (const event of input.damage.get(fight.id) ?? []) {
      if (!isMechanicHit(event, players, npcSources)) {
        continue;
      }
      if (isAfterCutoff(event.timestamp, cutoff)) {
        continue;
      }
      const amount = event.amount + (includeAbsorbed ? (event.absorbed ?? 0) : 0);

      const phase = phaseAt(sorted, event.timestamp);
      let abilities = byPhase.get(phase);
      if (!abilities) {
        abilities = new Map();
        byPhase.set(phase, abilities);
      }
      let phaseAgg = abilities.get(event.abilityGameID);
      if (!phaseAgg) {
        phaseAgg = emptyAgg();
        abilities.set(event.abilityGameID, phaseAgg);
      }
      record(phaseAgg, event.targetID, amount);

      let totalAgg = byAbility.get(event.abilityGameID);
      if (!totalAgg) {
        totalAgg = emptyAgg();
        byAbility.set(event.abilityGameID, totalAgg);
      }
      const previous = lastHitAt.get(event.abilityGameID);
      if (previous === undefined || event.timestamp - previous > OCCURRENCE_GAP_MS) {
        totalAgg.occurrences++;
      }
      lastHitAt.set(event.abilityGameID, event.timestamp);
      record(totalAgg, event.targetID, amount);
    }
  }

  return { byPhase, byAbility, sawTransitions };
}

export function toMechanicRow(
  phase: number,
  id: number,
  agg: Agg,
  input: Pick<AnalysisInput, 'abilities'>,
  playersById: ReadonlyMap<number, PlayerInfo>,
): MechanicRow {
  const ability = input.abilities.get(id);
  const perPlayer = [...agg.byPlayer.entries()]
    .map(([playerId, stats]) => {
      const player = playersById.get(playerId);
      return {
        name: player?.name ?? `#${playerId}`,
        color: player ? classColor(player.className) : 'var(--text-1)',
        damage: stats.damage,
        hits: stats.hits,
        pct: 0,
      };
    })
    .sort((a, b) => b.damage - a.damage);
  const max = perPlayer[0]?.damage ?? 1;
  for (const row of perPlayer) {
    row.pct = Math.max(2, Math.round((row.damage / max) * 100));
  }
  return {
    key: `${phase}:${id}`,
    id,
    name: ability?.name ?? `Ability #${id}`,
    icon: abilityIconUrl(ability?.icon),
    url: wowheadSpellUrl(id),
    hits: agg.hits,
    playersHit: agg.byPlayer.size,
    totalDamage: agg.total,
    avgHit: Math.round(agg.total / agg.hits),
    perPlayer,
  };
}

/** Mechanic tables grouped by phase, alphabetical within each phase. */
export function buildMechanicGroups(
  input: AnalysisInput,
  aggregate: DamageAggregate,
): PhaseGroup[] {
  const playersById = new Map(input.players.map((p) => [p.id, p]));
  const groups = [...aggregate.byPhase.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([phase, abilities]) => ({
      phase,
      label: null as string | null,
      mechanics: [...abilities.entries()]
        .map(([id, agg]) => toMechanicRow(phase, id, agg, input, playersById))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));

  if (groups.length > 1 || aggregate.sawTransitions) {
    for (const group of groups) {
      group.label = `Phase ${group.phase}`;
    }
  }
  return groups;
}
