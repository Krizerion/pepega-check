import {
  DamageEvent,
  DispelEvent,
  FightEvents,
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
  kind: 'damage' | 'cast';
  abilityId: number;
  name: string;
  icon: string;
  url: string | null;
  /** Damage only. */
  amount: number;
  /** Damage only: the blow that finished them. */
  fatal: boolean;
  /** Cast only: the catalog colour of its category. */
  color: string | null;
  /** Position across the window, 0-100. */
  pct: number;
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
  /** Total damage taken across the window. */
  damageTaken: number;
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
