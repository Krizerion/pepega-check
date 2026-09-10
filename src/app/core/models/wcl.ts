/** Domain models for Warcraft Logs v2 report data. */

export interface WclCredentials {
  clientId: string;
  clientSecret: string;
}

export interface WclToken {
  accessToken: string;
  /** Epoch ms after which the token is considered expired. */
  expiresAt: number;
}

export interface ReportFight {
  id: number;
  name: string;
  encounterID: number;
  difficulty: number | null;
  kill: boolean | null;
  /** Report-relative ms. */
  startTime: number;
  /** Report-relative ms. */
  endTime: number;
  /** Best boss health % reached (lower is closer to a kill). */
  fightPercentage: number | null;
  lastPhase: number | null;
  size: number | null;
  phaseTransitions?: { id: number; startTime: number }[] | null;
}

export interface ReportActor {
  id: number;
  name: string;
  type: string;
  subType: string;
  petOwner: number | null;
}

export interface ReportAbility {
  gameID: number;
  name: string | null;
  icon: string | null;
  type: string | null;
}

export interface Report {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  zoneName: string | null;
  fights: ReportFight[];
  actors: ReportActor[];
  abilities: Map<number, ReportAbility>;
}

export type PlayerRole = 'tank' | 'healer' | 'dps';

export interface PlayerInfo {
  id: number;
  name: string;
  /** WoW class in WCL notation, e.g. "DeathKnight". */
  className: string;
  spec: string | null;
  role: PlayerRole;
}

export interface CastEvent {
  timestamp: number;
  type: 'cast' | 'begincast';
  sourceID: number;
  targetID: number | null;
  abilityGameID: number;
}

export interface DeathEvent {
  timestamp: number;
  targetID: number;
  abilityGameID: number | null;
  /** The killing blow's ability — WCL sends this separately from abilityGameID. */
  killingAbilityGameID?: number | null;
  killerID?: number | null;
}

/** Best-effort ability id of the killing blow for a death event. */
export function killingAbilityId(death: DeathEvent): number | null {
  return death.killingAbilityGameID ?? death.abilityGameID ?? null;
}

/** All events fetched for a single fight (pull). */
export interface FightEvents {
  friendlyCasts: CastEvent[];
  enemyCasts: CastEvent[];
  deaths: DeathEvent[];
}

/** A unique boss encounter present in a report, with its pulls. */
export interface EncounterGroup {
  encounterID: number;
  name: string;
  difficulty: number | null;
  pulls: ReportFight[];
}

export const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'LFR',
  2: 'Flex',
  3: 'Normal',
  4: 'Heroic',
  5: 'Mythic',
};

export function difficultyLabel(difficulty: number | null): string {
  return difficulty === null ? '' : (DIFFICULTY_LABELS[difficulty] ?? `D${difficulty}`);
}

export function fightDuration(fight: ReportFight): number {
  return fight.endTime - fight.startTime;
}

/** Formats a fight-relative ms offset as m:ss (or h:mm:ss). */
export function formatOffset(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
