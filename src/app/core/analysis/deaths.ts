import { CATEGORY_META, classifyAbility } from '../data/ability-catalog';
import { abilityIconUrl, classColor } from '../data/wow';
import {
  CastEvent,
  DamageEvent,
  DeathEvent,
  HealEvent,
  ReportFight,
  killingAbilityId,
} from '../models/wcl';
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
import {
  AnalysisInput,
  DeathHealEntry,
  DeathHealGroup,
  DeathHealer,
  DeathStep,
  DeathMoment,
  DeathRow,
  LeaderboardRow,
  wowheadSpellUrl,
} from './types';

/** Who healed a raider, for labelling heal moments. */
type HealerNames = ReadonlyMap<number, { name: string; color: string }>;

/**
 * Warcraft Logs omits `amount` on some events in the healing and damage
 * streams (absorb-only entries, immunities). Left alone, one of those turns
 * every total downstream into NaN.
 */
function num(value: number | null | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

/** Health as a percentage, or null when the log carried no snapshot. */
function hpPercent(hitPoints?: number | null, maxHitPoints?: number | null): number | null {
  if (hitPoints == null || !maxHitPoints) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((hitPoints / maxHitPoints) * 100)));
}

/**
 * Reconstructs the run-up to a death: every mechanic that hit the player, every
 * heal that landed on them, and everything they pressed.
 *
 * The killing blow on its own is the least interesting part of a death — it is
 * usually just the last tick of something that had been going wrong for ten
 * seconds. The sequence, with health either side of each hit, is what separates
 * "chunked from full" from "ground down with nobody healing them".
 */
export function buildDeathTimeline(
  death: DeathEvent,
  input: Pick<AnalysisInput, 'abilities'>,
  casts: readonly CastEvent[],
  hits: readonly DamageEvent[],
  heals: readonly HealEvent[] = [],
  healerNames: HealerNames = new Map(),
): DeathMoment[] {
  const from = death.timestamp - MITIGATION_WINDOW_MS;
  const killer = killingAbilityId(death);
  const moments: DeathMoment[] = [];

  const base = {
    amount: 0,
    fatal: false,
    overkill: 0,
    color: null as string | null,
    sourceName: null as string | null,
    absorbed: 0,
    hpBefore: null as number | null,
    hpAfter: null as number | null,
    pct: 0,
    lane: 0,
  };

  for (const hit of hits) {
    if (hit.timestamp <= from || hit.timestamp > death.timestamp) {
      continue;
    }
    const ability = input.abilities.get(hit.abilityGameID);
    // Warcraft Logs reports health *after* an event, so the health going in is
    // that plus whatever the hit took off.
    const known = hit.hitPoints != null && !!hit.maxHitPoints;
    const amount = num(hit.amount);
    moments.push({
      ...base,
      beforeMs: death.timestamp - hit.timestamp,
      kind: 'damage',
      abilityId: hit.abilityGameID,
      name: ability?.name ?? `Ability #${hit.abilityGameID}`,
      icon: abilityIconUrl(ability?.icon),
      url: hit.abilityGameID > 1 ? wowheadSpellUrl(hit.abilityGameID) : null,
      amount,
      overkill: num(hit.overkill),
      absorbed: num(hit.absorbed),
      hpBefore: known ? hpPercent(hit.hitPoints! + amount, hit.maxHitPoints) : null,
      hpAfter: hpPercent(hit.hitPoints, hit.maxHitPoints),
    });
  }

  for (const heal of heals) {
    const healed = num(heal.amount);
    if (heal.timestamp <= from || heal.timestamp > death.timestamp || healed <= 0) {
      continue;
    }
    const ability = input.abilities.get(heal.abilityGameID);
    const source = heal.sourceID === null ? undefined : healerNames.get(heal.sourceID);
    const known = heal.hitPoints != null && !!heal.maxHitPoints;
    moments.push({
      ...base,
      beforeMs: death.timestamp - heal.timestamp,
      kind: 'heal',
      abilityId: heal.abilityGameID,
      name: ability?.name ?? 'Healing',
      icon: abilityIconUrl(ability?.icon),
      url: heal.abilityGameID > 1 ? wowheadSpellUrl(heal.abilityGameID) : null,
      amount: healed,
      sourceName: source?.name ?? null,
      color: source?.color ?? null,
      hpBefore: known ? hpPercent(heal.hitPoints! - healed, heal.maxHitPoints) : null,
      hpAfter: hpPercent(heal.hitPoints, heal.maxHitPoints),
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
      ...base,
      beforeMs: death.timestamp - cast.timestamp,
      kind: 'cast',
      abilityId: cast.abilityGameID,
      name: ability?.name ?? `#${cast.abilityGameID}`,
      icon: abilityIconUrl(ability?.icon),
      url: wowheadSpellUrl(cast.abilityGameID),
      color: CATEGORY_META.get(category)?.color ?? null,
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

  /*
   * Chain each reading off the previous one. `hitPoints + amount` is only a
   * sound estimate for a hit the raider survived: on the killing blow the
   * damage exceeded the health left (the excess is `overkill`), so the
   * arithmetic would report them at 7% when they were at 94% a moment earlier.
   */
  let previous: number | null = null;
  for (const moment of moments) {
    if (previous !== null && moment.hpAfter !== null) {
      moment.hpBefore = previous;
    }
    if (moment.hpAfter !== null) {
      previous = moment.hpAfter;
    }
    moment.pct = Math.round(
      ((MITIGATION_WINDOW_MS - moment.beforeMs) / MITIGATION_WINDOW_MS) * 100,
    );
  }

  assignLanes(moments);
  return moments;
}

/**
 * Nudges markers that would be drawn on top of each other.
 *
 * Each kind already has its own row of the strip, so this only has to separate
 * an event from the last one of its own sort — three ticks of the same mechanic
 * inside half a second, say, which would otherwise render as a single icon.
 */
export const MARKER_GAP_PCT = 3.2;
const MAX_LANES = 3;

function assignLanes(moments: DeathMoment[]): void {
  const lastOfKind = new Map<string, { pct: number; lane: number }>();
  for (const moment of moments) {
    const previous = lastOfKind.get(moment.kind);
    moment.lane =
      previous && moment.pct - previous.pct < MARKER_GAP_PCT ? (previous.lane + 1) % MAX_LANES : 0;
    lastOfKind.set(moment.kind, { pct: moment.pct, lane: moment.lane });
  }
}

/**
 * One line per healer rather than one per tick. A 12-second window can hold
 * dozens of heal events, and "who was healing him, and how much" is the
 * question — not which HoT ticked when.
 */
export function consolidateHealers(moments: readonly DeathMoment[]): DeathHealer[] {
  const byHealer = new Map<string, DeathHealer>();
  for (const moment of moments) {
    if (moment.kind !== 'heal') {
      continue;
    }
    const name = moment.sourceName ?? 'Unknown';
    let entry = byHealer.get(name);
    if (!entry) {
      entry = { name, color: moment.color ?? 'var(--text-1)', amount: 0, overheal: 0, casts: 0 };
      byHealer.set(name, entry);
    }
    entry.amount += num(moment.amount);
    entry.casts++;
  }
  return [...byHealer.values()].sort((a, b) => b.amount - a.amount);
}

/**
 * Folds consecutive heals into a single line.
 *
 * A real 12-second window can hold forty HoT ticks of a few hundred each; one
 * row per tick buries the two or three hits that actually explain the death.
 * A run becomes "−11.9s to −10.3s · +48.5k from 4 healers", openable for the
 * per-healer, per-ability breakdown.
 */
export function buildDeathSteps(moments: readonly DeathMoment[]): DeathStep[] {
  const steps: DeathStep[] = [];
  let run: DeathMoment[] = [];

  const flush = () => {
    if (run.length === 0) {
      return;
    }
    // A lone heal reads better as itself than as a group of one.
    if (run.length === 1) {
      steps.push({ kind: 'event', moment: run[0] });
      run = [];
      return;
    }
    const first = run[0];
    const last = run[run.length - 1];
    const byKey = new Map<string, DeathHealEntry>();
    for (const heal of run) {
      const healer = heal.sourceName ?? 'Unknown';
      const key = `${healer}:${heal.abilityId}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          healer,
          color: heal.color ?? 'var(--text-1)',
          abilityId: heal.abilityId ?? 0,
          abilityName: heal.name,
          icon: heal.icon,
          url: heal.url,
          amount: 0,
          casts: 0,
        };
        byKey.set(key, entry);
      }
      entry.amount += heal.amount;
      entry.casts++;
    }
    const group: DeathHealGroup = {
      key: `heals:${first.beforeMs}`,
      fromMs: first.beforeMs,
      toMs: last.beforeMs,
      amount: run.reduce((sum, heal) => sum + heal.amount, 0),
      casts: run.length,
      hpBefore: first.hpBefore,
      hpAfter: last.hpAfter,
      entries: [...byKey.values()].sort((a, b) => b.amount - a.amount),
    };
    steps.push({ kind: 'heals', group });
    run = [];
  };

  for (const moment of moments) {
    if (moment.kind === 'heal') {
      run.push(moment);
      continue;
    }
    flush();
    steps.push({ kind: 'event', moment });
  }
  flush();
  return steps;
}

/** Health readings across the window, for the trace drawn on the row. */
export function buildHpTrace(moments: readonly DeathMoment[]): {
  trace: { x: number; y: number }[];
  start: number | null;
} {
  const trace: { x: number; y: number }[] = [];
  let start: number | null = null;

  for (const moment of moments) {
    if (moment.hpAfter === null) {
      continue;
    }
    if (start === null && moment.hpBefore !== null) {
      start = moment.hpBefore;
      trace.push({ x: 0, y: moment.hpBefore });
    }
    trace.push({ x: moment.pct, y: moment.hpAfter });
  }
  // However it went, it ended at zero.
  if (trace.length > 0) {
    trace.push({ x: 100, y: 0 });
  }
  return { trace, start };
}

/** Chronological death log for one fight, given precomputed player indexes. */
function deathRows(
  fight: ReportFight,
  input: AnalysisInput,
  casts: ReadonlyMap<number, CastEvent[]>,
  kits: ReadonlyMap<number, Set<number>>,
  hits: ReadonlyMap<number, DamageEvent[]>,
  heals: ReadonlyMap<number, HealEvent[]>,
  healerNames: HealerNames,
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
      const timeline = buildDeathTimeline(
        death,
        input,
        mine,
        hits.get(death.targetID) ?? [],
        heals.get(death.targetID) ?? [],
        healerNames,
      );
      const { trace, start } = buildHpTrace(timeline);
      const healers = consolidateHealers(timeline);
      const steps = buildDeathSteps(timeline);

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
        steps,
        damageTaken: timeline
          .filter((moment) => moment.kind === 'damage')
          .reduce((sum, moment) => sum + moment.amount, 0),
        hpTrace: trace,
        hpStart: start,
        healers,
        healingReceived: healers.reduce((sum, healer) => sum + healer.amount, 0),
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

/** Healing received by each raider in one fight, chronological. */
function healsByPlayer(fight: ReportFight, input: AnalysisInput): Map<number, HealEvent[]> {
  const byPlayer = new Map<number, HealEvent[]>();
  for (const event of input.healing?.get(fight.id) ?? []) {
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

function healerNamesOf(input: AnalysisInput): HealerNames {
  return new Map(
    input.players.map((player) => [
      player.id,
      { name: player.name, color: classColor(player.className) },
    ]),
  );
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
    healsByPlayer(fight, input),
    healerNamesOf(input),
  );
}

/** Deaths per player across the scope, with how many had nothing pressed. */
export function buildDeathLeaderboard(input: AnalysisInput): LeaderboardRow[] {
  const kits = knownKits(input, input.fights);
  const healers = healerNamesOf(input);
  const rows = new Map<number, LeaderboardRow>();

  for (const fight of input.fights) {
    for (const death of deathRows(
      fight,
      input,
      castsByPlayer(fight.id, input),
      kits,
      hitsByPlayer(fight, input),
      healsByPlayer(fight, input),
      healers,
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
