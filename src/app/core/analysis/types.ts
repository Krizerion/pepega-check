import {
  DamageEvent,
  DispelEvent,
  FightEvents,
  HealEvent,
  PlayerInfo,
  ReportAbility,
  ReportActor,
  ReportFight,
} from '../models/wcl';

/** Everything the analysis functions need, with no Angular or store coupling. */
export interface AnalysisInput {
  fights: ReportFight[];
  players: PlayerInfo[];
  abilities: ReadonlyMap<number, ReportAbility>;
  actors: readonly ReportActor[];
  events: ReadonlyMap<number, FightEvents>;
  damage: ReadonlyMap<number, DamageEvent[]>;
  dispels: ReadonlyMap<number, DispelEvent[]>;
  /** Only loaded for the pull whose death log is open. */
  healing?: ReadonlyMap<number, HealEvent[]>;
  /** Stop counting after the Nth death of each fight; null = whole fight. */
  ignoreAfterDeaths: number | null;
}

export interface PlayerHits {
  name: string;
  color: string;
  damage: number;
  hits: number;
  /** Bar width relative to the hardest-hit player, 0-100. */
  pct: number;
}

export interface MechanicRow {
  /** Unique per phase + ability, used for expansion state. */
  key: string;
  id: number;
  name: string;
  icon: string;
  url: string;
  hits: number;
  playersHit: number;
  totalDamage: number;
  avgHit: number;
  perPlayer: PlayerHits[];
}

export interface PhaseGroup {
  phase: number;
  /** null = single unlabelled group (fight has no phases). */
  label: string | null;
  mechanics: MechanicRow[];
}

export interface AvoidableMechanic {
  id: number;
  name: string;
  icon: string;
  url: string;
  damage: number;
  hits: number;
  /** Bar width relative to this player's worst mechanic, 0-100. */
  pct: number;
}

export interface AvoidableRow {
  name: string;
  color: string;
  damage: number;
  hits: number;
  /** Average per pull in the scope. */
  perPull: number;
  /** Bar width relative to the worst raider, 0-100. */
  pct: number;
  mechanics: AvoidableMechanic[];
}

/** A survival cast credited with covering a hit. */
export interface Mitigation {
  name: string;
  icon: string;
  secondsBefore: number;
}

/** A survival cooldown, for display. */
export interface SurvivalCd {
  id: number;
  name: string;
  icon: string;
}

/** One thing that happened to a player shortly before they died. */
export interface DeathMoment {
  /** How long before the death, in ms. */
  beforeMs: number;
  kind: 'damage' | 'heal' | 'cast';
  abilityId: number;
  name: string;
  icon: string;
  url: string | null;
  /** Damage and heal amounts. */
  amount: number;
  /** Damage only: the blow that finished them. */
  fatal: boolean;
  /** Damage only: how far past zero the killing blow went. */
  overkill: number;
  /** Damage only: the part a shield ate, so a 0-damage hit can say why. */
  absorbed: number;
  /** Cast only: the catalog colour of its category. */
  color: string | null;
  /** Who healed, for heal moments. */
  sourceName: string | null;
  /**
   * Health either side of the event, as a percentage. Null when the log did not
   * carry a health snapshot for it.
   */
  hpBefore: number | null;
  hpAfter: number | null;
  /** Position across the window, 0-100. */
  pct: number;
  /** Stagger level for markers that would otherwise sit on top of each other. */
  lane: number;
}

/** One healer's contribution to a run of heals, by ability. */
export interface DeathHealEntry {
  healer: string;
  color: string;
  abilityId: number;
  abilityName: string;
  icon: string;
  url: string | null;
  amount: number;
  casts: number;
}

/**
 * A run of consecutive heals, folded into one line.
 *
 * A real log puts dozens of HoT ticks into a 12-second window; listed one per
 * row they bury the handful of events that actually explain the death.
 */
export interface DeathHealGroup {
  /** Unique within the death, for expansion state. */
  key: string;
  /** Window covered, in ms before the death (from is the larger number). */
  fromMs: number;
  toMs: number;
  amount: number;
  casts: number;
  hpBefore: number | null;
  hpAfter: number | null;
  entries: DeathHealEntry[];
}

/** A line in the expanded sequence: one event, or a folded run of heals. */
export type DeathStep =
  | { kind: 'event'; moment: DeathMoment; group?: undefined }
  | { kind: 'heals'; group: DeathHealGroup; moment?: undefined };

/** Healing one player put into the dying raider during the window. */
export interface DeathHealer {
  name: string;
  color: string;
  amount: number;
  overheal: number;
  casts: number;
}

export interface DeathRow {
  timeMs: number;
  playerId: number;
  playerName: string;
  playerColor: string;
  abilityName: string;
  abilityIcon: string;
  abilityUrl: string | null;
  mitigation: Mitigation | null;
  /** Survival abilities known to be off cooldown when the player died. */
  available: SurvivalCd[];
  /** Everything that hit them, and everything they pressed, before dying. */
  timeline: DeathMoment[];
  /** The same sequence for reading, with runs of heals folded together. */
  steps: DeathStep[];
  /** Total damage taken across the window. */
  damageTaken: number;
  /**
   * Health readings across the window as {x, y} percentages, for the trace on
   * the row. Empty when the log carried no health snapshots.
   */
  hpTrace: { x: number; y: number }[];
  /** Health when the window opened, or null if unknown. */
  hpStart: number | null;
  /** Who was healing them, consolidated — one line per healer, not per tick. */
  healers: DeathHealer[];
  healingReceived: number;
}

export interface LeaderboardRow {
  name: string;
  color: string;
  deaths: number;
  unmitigated: number;
}

export interface UtilityRow {
  name: string;
  color: string;
  /** Personal defensives and immunities pressed. */
  defensives: number;
  /** Raid-wide cooldowns pressed (externals, healing CDs). */
  raidCds: number;
  combatPots: number;
  healthPots: number;
  dispels: number;
  deaths: number;
}

/** Per-ability damage aggregate over the fights in scope. */
export interface Agg {
  hits: number;
  total: number;
  byPlayer: Map<number, { damage: number; hits: number }>;
  /** Distinct casts (hit clusters), used to judge how wide a mechanic spreads. */
  occurrences: number;
}

export interface DamageAggregate {
  byPhase: Map<number, Map<number, Agg>>;
  byAbility: Map<number, Agg>;
  sawTransitions: boolean;
}

export interface PhaseKiller {
  id: number;
  name: string;
  icon: string;
  url: string | null;
  deaths: number;
}

/** Where pulls end, aggregated across the scope. */
export interface PhaseWipeRow {
  phase: number;
  /** "Phase 2", under the shared `name` key so column sorting works. */
  name: string;
  /** Pulls that entered this phase. */
  reached: number;
  /** Pulls that got past it. */
  cleared: number;
  /** Pulls that ended here without a kill. */
  wipes: number;
  deaths: number;
  /** Deaths per pull that reached the phase. */
  deathsPerPull: number;
  /** Fight-relative window holding the middle half of this phase's deaths. */
  window: { fromMs: number; toMs: number } | null;
  /** Median fight-relative time of the wipes that ended here. */
  medianWipeMs: number | null;
  killers: PhaseKiller[];
  /** Bar width relative to the deadliest phase, 0-100. */
  pct: number;
}

export function wowheadSpellUrl(spellId: number): string {
  return `https://www.wowhead.com/spell=${spellId}`;
}
