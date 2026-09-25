import { Injectable, inject } from '@angular/core';

import {
  CastEvent,
  DamageEvent,
  DeathEvent,
  DispelEvent,
  FightEvents,
  HealEvent,
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

/**
 * `includeResources` is what attaches each actor's health to an event. Without
 * it the damage and healing streams carry no health at all, which is why the
 * death log could draw a health trace for the bundled demo (which fabricates
 * the numbers) but not for a real report.
 *
 * It roughly doubles the size of an event, so it is only asked for on the two
 * streams that read health, never on casts or deaths.
 */
function eventsQuery(withResources: boolean): string {
  return `
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
        ${withResources ? 'includeResources: true' : ''}
        limit: 10000
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}`;
}

const EVENTS_QUERY = eventsQuery(false);
const EVENTS_QUERY_WITH_RESOURCES = eventsQuery(true);

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

  /** Cleared for the session if the API rejects `includeResources`. */
  private resourcesSupported = true;

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
    return flattenTargetHealth(
      await this.fetchAllEvents<DamageEvent>(code, fight, 'DamageTaken', 'Friendlies', true),
    );
  }

  /**
   * Healing landing on players. Only fetched for a pull whose death log is open:
   * healing is by far the chattiest event stream, so it is not worth pulling for
   * every pull in an encounter up front.
   */
  async fetchHealing(code: string, fight: ReportFight): Promise<HealEvent[]> {
    return flattenTargetHealth(
      await this.fetchAllEvents<HealEvent>(code, fight, 'Healing', 'Friendlies', true),
    );
  }

  /** Successful dispels by players (failed dispel casts are not included). */
  async fetchDispels(code: string, fight: ReportFight): Promise<DispelEvent[]> {
    return this.fetchAllEvents<DispelEvent>(code, fight, 'Dispels', 'Friendlies');
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
    dataType: 'Casts' | 'Deaths' | 'DamageTaken' | 'Dispels' | 'Healing',
    hostility: 'Friendlies' | 'Enemies',
    withResources = false,
  ): Promise<T[]> {
    const events: T[] = [];
    let startTime = fight.startTime;

    for (;;) {
      const page = await this.eventPage<T>(
        code,
        fight,
        dataType,
        hostility,
        withResources,
        startTime,
      );
      events.push(...page.data);
      if (page.nextPageTimestamp === null) {
        return events;
      }
      startTime = page.nextPageTimestamp;
    }
  }

  /** One page of events, retrying without resources if the API rejects them. */
  private async eventPage<T>(
    code: string,
    fight: ReportFight,
    dataType: string,
    hostility: string,
    withResources: boolean,
    startTime: number,
  ): Promise<{ data: T[]; nextPageTimestamp: number | null }> {
    const useResources = withResources && this.resourcesSupported;
    try {
      const data = await this.query<{
        reportData: {
          report: { events: { data: T[]; nextPageTimestamp: number | null } };
        };
      }>(useResources ? EVENTS_QUERY_WITH_RESOURCES : EVENTS_QUERY, {
        code,
        fightID: fight.id,
        startTime,
        endTime: fight.endTime,
        dataType,
        hostility,
      });
      return data.reportData.report.events;
    } catch (e) {
      // Losing the health trace is a far better outcome than losing the events,
      // so if this deployment's API does not know the argument, drop it and
      // carry on without health for the rest of the session.
      if (useResources && e instanceof Error && /includeResources/i.test(e.message)) {
        this.resourcesSupported = false;
        return this.eventPage<T>(code, fight, dataType, hostility, false, startTime);
      }
      throw e;
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

/**
 * Moves the target's health from the resources block onto the event.
 *
 * Warcraft Logs nests it under `targetResources`; everything downstream reads
 * flat `hitPoints`/`maxHitPoints`, and the bundled demo already produces that
 * shape, so normalising here keeps one shape in the rest of the app.
 */
function flattenTargetHealth<T extends DamageEvent | HealEvent>(events: T[]): T[] {
  for (const event of events) {
    const resources = event.targetResources;
    if (resources && event.hitPoints == null) {
      event.hitPoints = resources.hitPoints ?? null;
      event.maxHitPoints = resources.maxHitPoints ?? null;
    }
  }
  return events;
}
