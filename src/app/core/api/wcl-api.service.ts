import { Injectable, inject } from '@angular/core';

import {
  CastEvent,
  DamageEvent,
  DeathEvent,
  FightEvents,
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

interface GraphQlError {
  message: string;
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
