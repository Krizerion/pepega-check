import { Injectable, inject } from '@angular/core';

import {
  CastEvent,
  DamageEvent,
  DeathEvent,
  FightEvents,
  FightPerformance,
  PlayerPerformance,
  PlayerInfo,
  PlayerRole,
  Report,
  ReportAbility,
  ReportActor,
  ReportFight,
} from '../models/wcl';
import { WclAuthService } from './wcl-auth.service';

const API_URL = 'https://www.warcraftlogs.com/api/v2/client';

const REPORT_QUERY = `
query ReportOverview($code: String!) {
  reportData {
    report(code: $code) {
      title
      startTime
      endTime
      zone { name }
      fights(killType: Encounters) {
        id
        name
        encounterID
        difficulty
        kill
        startTime
        endTime
        fightPercentage
        lastPhase
        size
        phaseTransitions { id startTime }
      }
      masterData(translate: true) {
        actors { id name type subType petOwner }
        abilities { gameID name icon type }
      }
    }
  }
}`;

const PLAYER_DETAILS_QUERY = `
query PlayerDetails($code: String!, $fightIDs: [Int]!) {
  reportData {
    report(code: $code) {
      playerDetails(fightIDs: $fightIDs)
    }
  }
}`;

const EVENTS_QUERY = `
query FightEvents(
  $code: String!
  $fightID: Int!
  $startTime: Float!
  $endTime: Float!
  $dataType: EventDataType!
  $hostility: HostilityType!
) {
  reportData {
    report(code: $code) {
      events(
        fightIDs: [$fightID]
        startTime: $startTime
        endTime: $endTime
        dataType: $dataType
        hostilityType: $hostility
        useAbilityIDs: true
        limit: 10000
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}`;

const TABLE_QUERY = `
query Table($code: String!, $fightID: Int!, $dataType: TableDataType!) {
  reportData {
    report(code: $code) {
      table(fightIDs: [$fightID], dataType: $dataType)
    }
  }
}`;

const RANKINGS_QUERY = `
query Rankings($code: String!, $fightID: Int!, $metric: ReportRankingMetricType!) {
  reportData {
    report(code: $code) {
      rankings(fightIDs: [$fightID], playerMetric: $metric)
    }
  }
}`;

interface GraphQlError {
  message: string;
}

interface RawTableEntry {
  id: number;
  name: string;
  total?: number;
  petOwner?: number | null;
}

interface RawRankingCharacter {
  name: string;
  rankPercent?: number | null;
}

interface RawPlayerDetails {
  id: number;
  name: string;
  type: string;
  specs?: { spec: string }[];
}

/** Thin, typed client for the Warcraft Logs v2 GraphQL API. */
@Injectable({ providedIn: 'root' })
export class WclApiService {
  private readonly auth = inject(WclAuthService);

  async fetchReport(code: string): Promise<Report> {
    const data = await this.query<{
      reportData: {
        report: {
          title: string;
          startTime: number;
          endTime: number;
          zone: { name: string } | null;
          fights: ReportFight[];
          masterData: { actors: ReportActor[]; abilities: ReportAbility[] };
        } | null;
      };
    }>(REPORT_QUERY, { code });

    const report = data.reportData.report;
    if (!report) {
      throw new Error(`Report "${code}" was not found or is private.`);
    }

    return {
      code,
      title: report.title,
      startTime: report.startTime,
      endTime: report.endTime,
      zoneName: report.zone?.name ?? null,
      fights: report.fights,
      actors: report.masterData.actors,
      abilities: new Map(report.masterData.abilities.map((a) => [a.gameID, a])),
    };
  }

  async fetchPlayerDetails(code: string, fightIds: number[]): Promise<PlayerInfo[]> {
    const data = await this.query<{
      reportData: {
        report: {
          playerDetails: {
            data?: {
              playerDetails?: Partial<Record<'tanks' | 'healers' | 'dps', RawPlayerDetails[]>>;
            };
          };
        };
      };
    }>(PLAYER_DETAILS_QUERY, { code, fightIDs: fightIds });

    const details = data.reportData.report.playerDetails.data?.playerDetails ?? {};
    const roleMap: [PlayerRole, RawPlayerDetails[]][] = [
      ['tank', details.tanks ?? []],
      ['healer', details.healers ?? []],
      ['dps', details.dps ?? []],
    ];

    return roleMap.flatMap(([role, players]) =>
      players.map((p) => ({
        id: p.id,
        name: p.name,
        className: p.type,
        spec: p.specs?.[0]?.spec ?? null,
        role,
      })),
    );
  }

  async fetchFightEvents(code: string, fight: ReportFight): Promise<FightEvents> {
    const [friendlyCasts, enemyCasts, deaths] = await Promise.all([
      this.fetchAllEvents<CastEvent>(code, fight, 'Casts', 'Friendlies'),
      this.fetchAllEvents<CastEvent>(code, fight, 'Casts', 'Enemies'),
      this.fetchAllEvents<DeathEvent>(code, fight, 'Deaths', 'Friendlies'),
    ]);
    return {
      friendlyCasts: friendlyCasts.filter((e) => e.type === 'cast'),
      // sourceID -1 is the Environment actor: WCL reports ground effects that
      // players place (e.g. Anti-Magic Zone) as enemy-hostility casts from it.
      enemyCasts: enemyCasts.filter((e) => e.sourceID >= 0),
      deaths,
    };
  }

  /** Damage taken by friendly players — the basis for mechanic analysis. */
  async fetchDamageTaken(code: string, fight: ReportFight): Promise<DamageEvent[]> {
    return this.fetchAllEvents<DamageEvent>(code, fight, 'DamageTaken', 'Friendlies');
  }

  /** Per-player damage/healing totals, plus WCL parses for kills. */
  async fetchPerformance(code: string, fight: ReportFight): Promise<FightPerformance> {
    const [damage, healing] = await Promise.all([
      this.fetchTable(code, fight.id, 'DamageDone'),
      this.fetchTable(code, fight.id, 'Healing'),
    ]);

    const entries = new Map<number, PlayerPerformance>();
    const add = (
      table: Map<number, { name: string; total: number }>,
      field: 'damage' | 'healing',
    ) => {
      for (const [actorId, { name, total }] of table) {
        let entry = entries.get(actorId);
        if (!entry) {
          entry = { actorId, name, damage: 0, healing: 0 };
          entries.set(actorId, entry);
        }
        entry[field] += total;
      }
    };
    add(damage, 'damage');
    add(healing, 'healing');

    return {
      entries: [...entries.values()],
      parses: fight.kill ? await this.fetchParses(code, fight.id) : null,
    };
  }

  /** One summary table; pet totals are folded into their owners. */
  private async fetchTable(
    code: string,
    fightId: number,
    dataType: 'DamageDone' | 'Healing',
  ): Promise<Map<number, { name: string; total: number }>> {
    const data = await this.query<{
      reportData: { report: { table: { data?: { entries?: RawTableEntry[] } } } };
    }>(TABLE_QUERY, { code, fightID: fightId, dataType });

    const entries = data.reportData.report.table.data?.entries ?? [];
    const totals = new Map<number, { name: string; total: number }>();
    const pets: RawTableEntry[] = [];
    for (const entry of entries) {
      if (entry.petOwner != null) {
        pets.push(entry);
      } else {
        totals.set(entry.id, { name: entry.name, total: entry.total ?? 0 });
      }
    }
    for (const pet of pets) {
      const owner = totals.get(pet.petOwner!);
      if (owner) {
        owner.total += pet.total ?? 0;
      }
    }
    return totals;
  }

  /** Rank percentiles by player name: hps for healers, dps for everyone else. */
  private async fetchParses(code: string, fightId: number): Promise<Record<string, number>> {
    const [dps, hps] = await Promise.all([
      this.fetchRanking(code, fightId, 'dps'),
      this.fetchRanking(code, fightId, 'hps'),
    ]);
    return { ...dps.all, ...hps.healersOnly };
  }

  private async fetchRanking(
    code: string,
    fightId: number,
    metric: 'dps' | 'hps',
  ): Promise<{ all: Record<string, number>; healersOnly: Record<string, number> }> {
    const data = await this.query<{
      reportData: {
        report: {
          rankings: {
            data?: {
              fightID: number;
              roles?: Partial<
                Record<'tanks' | 'healers' | 'dps', { characters?: RawRankingCharacter[] }>
              >;
            }[];
          };
        };
      };
    }>(RANKINGS_QUERY, { code, fightID: fightId, metric });

    const all: Record<string, number> = {};
    const healersOnly: Record<string, number> = {};
    const fightRanking = data.reportData.report.rankings.data?.find((r) => r.fightID === fightId);
    for (const role of ['tanks', 'healers', 'dps'] as const) {
      for (const character of fightRanking?.roles?.[role]?.characters ?? []) {
        if (character.rankPercent == null) {
          continue;
        }
        all[character.name] = character.rankPercent;
        if (role === 'healers') {
          healersOnly[character.name] = character.rankPercent;
        }
      }
    }
    return { all, healersOnly };
  }

  private async fetchAllEvents<T>(
    code: string,
    fight: ReportFight,
    dataType: 'Casts' | 'Deaths' | 'DamageTaken',
    hostility: 'Friendlies' | 'Enemies',
  ): Promise<T[]> {
    const events: T[] = [];
    let startTime = fight.startTime;

    for (;;) {
      const data = await this.query<{
        reportData: {
          report: { events: { data: T[]; nextPageTimestamp: number | null } };
        };
      }>(EVENTS_QUERY, {
        code,
        fightID: fight.id,
        startTime,
        endTime: fight.endTime,
        dataType,
        hostility,
      });

      const page = data.reportData.report.events;
      events.push(...page.data);
      if (page.nextPageTimestamp === null) {
        return events;
      }
      startTime = page.nextPageTimestamp;
    }
  }

  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const token = await this.auth.getAccessToken();
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? 'Warcraft Logs rejected the access token. Re-check your credentials in Settings.'
          : `Warcraft Logs API request failed (${response.status}).`,
      );
    }

    const body = (await response.json()) as { data?: T; errors?: GraphQlError[] };
    if (body.errors?.length) {
      throw new Error(`Warcraft Logs API error: ${body.errors[0].message}`);
    }
    if (!body.data) {
      throw new Error('Warcraft Logs API returned an empty response.');
    }
    return body.data;
  }
}
