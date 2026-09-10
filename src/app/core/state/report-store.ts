import { Injectable, computed, inject, signal } from '@angular/core';

import { WclApiService } from '../api/wcl-api.service';
import { AbilityCategory, CATEGORIES } from '../data/ability-catalog';
import { DEMO_REPORT_CODE, buildDemoReport } from '../data/demo-report';
import {
  EncounterGroup,
  FightEvents,
  PlayerInfo,
  PlayerRole,
  Report,
  ReportFight,
} from '../models/wcl';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** "pull" = one pull, all raiders; "player" = one raider, all pulls. */
export type ViewMode = 'pull' | 'player';

const REPORT_URL_PATTERN = /reports\/((?:a:)?[A-Za-z0-9]{10,})/;

@Injectable({ providedIn: 'root' })
export class ReportStore {
  private readonly api = inject(WclApiService);

  // --- report loading ---
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly report = signal<Report | null>(null);
  readonly players = signal<PlayerInfo[]>([]);

  private readonly eventsByFight = signal<ReadonlyMap<number, FightEvents>>(new Map());
  readonly loadingFights = signal<ReadonlySet<number>>(new Set());
  private readonly inflight = new Map<number, Promise<void>>();
  private demoEvents: Map<number, FightEvents> | null = null;
  private playerDetailsCache = new Map<string, PlayerInfo[]>();

  // --- selection ---
  readonly selectedEncounterKey = signal<string | null>(null);
  readonly selectedPullId = signal<number | null>(null);
  readonly selectedPlayerId = signal<number | null>(null);
  readonly viewMode = computed<ViewMode>(() =>
    this.selectedPlayerId() === null ? 'pull' : 'player',
  );

  // --- filters ---
  readonly enabledCategories = signal<ReadonlySet<AbilityCategory>>(
    new Set(CATEGORIES.map((c) => c.id)),
  );
  readonly showDeaths = signal(true);
  readonly showBossAbilities = signal(true);
  /** Pull view: extend boss casts as vertical lines through all raider rows. */
  readonly showCastLines = signal(false);
  /** Pull view: false = single merged boss lane, true = one row per boss ability. */
  readonly bossLaneExpanded = signal(false);
  readonly enabledRoles = signal<ReadonlySet<PlayerRole>>(new Set(['tank', 'healer', 'dps']));
  /** Role groups collapsed in the pull view (headers stay visible). */
  readonly collapsedRoles = signal<ReadonlySet<PlayerRole>>(new Set());
  /** Pulls excluded from the player view and aggregates. */
  readonly excludedPullIds = signal<ReadonlySet<number>>(new Set());
  /** Pull view: grey out everything after the Nth death (null = off). */
  readonly ignoreAfterDeaths = signal<number | null>(null);
  readonly showAnalysis = signal(false);
  /** null = all boss abilities visible. */
  readonly selectedBossAbilityIds = signal<ReadonlySet<number> | null>(null);
  readonly pxPerSecond = signal(3);

  // --- derived ---
  readonly encounters = computed<EncounterGroup[]>(() => {
    const report = this.report();
    if (!report) {
      return [];
    }
    const groups = new Map<string, EncounterGroup>();
    for (const fight of report.fights) {
      const key = encounterKey(fight);
      let group = groups.get(key);
      if (!group) {
        group = {
          encounterID: fight.encounterID,
          name: fight.name,
          difficulty: fight.difficulty,
          pulls: [],
        };
        groups.set(key, group);
      }
      group.pulls.push(fight);
    }
    return [...groups.values()];
  });

  readonly selectedEncounter = computed<EncounterGroup | null>(() => {
    const key = this.selectedEncounterKey();
    return this.encounters().find((e) => groupKey(e) === key) ?? null;
  });

  readonly selectedPull = computed<ReportFight | null>(() => {
    const id = this.selectedPullId();
    return this.selectedEncounter()?.pulls.find((p) => p.id === id) ?? null;
  });

  readonly selectedPlayer = computed<PlayerInfo | null>(() => {
    const id = this.selectedPlayerId();
    return this.players().find((p) => p.id === id) ?? null;
  });

  /** Fights whose events feed the current view (one pull, or all pulls in player mode). */
  readonly fightsInView = computed<ReportFight[]>(() => {
    const encounter = this.selectedEncounter();
    if (!encounter) {
      return [];
    }
    if (this.viewMode() === 'player') {
      const excluded = this.excludedPullIds();
      return encounter.pulls.filter((p) => !excluded.has(p.id));
    }
    const pull = this.selectedPull();
    return pull ? [pull] : [];
  });

  /** Boss/NPC abilities cast during the fights in view, most frequent first. */
  readonly bossAbilities = computed<BossAbility[]>(() => {
    const report = this.report();
    if (!report) {
      return [];
    }
    const events = this.eventsByFight();
    const counts = new Map<number, number>();
    for (const fight of this.fightsInView()) {
      for (const cast of events.get(fight.id)?.enemyCasts ?? []) {
        if (cast.type !== 'cast' || cast.abilityGameID <= 1) {
          continue;
        }
        counts.set(cast.abilityGameID, (counts.get(cast.abilityGameID) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([id, count]) => {
        const ability = report.abilities.get(id);
        return {
          id,
          name: ability?.name ?? `Ability #${id}`,
          icon: ability?.icon ?? null,
          count,
        };
      })
      .filter((a) => a.name.toLowerCase() !== 'melee')
      .sort((a, b) => b.count - a.count);
  });

  eventsFor(fightId: number): FightEvents | null {
    return this.eventsByFight().get(fightId) ?? null;
  }

  readonly events = this.eventsByFight.asReadonly();

  async loadReport(input: string): Promise<void> {
    const code = parseReportCode(input);
    if (!code) {
      this.fail('That does not look like a Warcraft Logs report URL or code.');
      return;
    }

    this.status.set('loading');
    this.error.set(null);
    this.resetSelection();
    this.eventsByFight.set(new Map());
    this.inflight.clear();
    this.playerDetailsCache.clear();
    this.demoEvents = null;

    try {
      if (code === DEMO_REPORT_CODE) {
        const demo = buildDemoReport();
        this.report.set(demo.report);
        this.players.set(demo.players);
        this.demoEvents = demo.eventsByFight;
      } else {
        const report = await this.api.fetchReport(code);
        if (report.fights.length === 0) {
          throw new Error('This report contains no boss encounters.');
        }
        this.report.set(report);
      }
      this.status.set('ready');
      const first = this.encounters().at(-1);
      if (first) {
        await this.selectEncounter(groupKey(first));
      }
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Failed to load the report.');
    }
  }

  async selectEncounter(key: string): Promise<void> {
    this.selectedEncounterKey.set(key);
    this.selectedPlayerId.set(null);
    this.selectedBossAbilityIds.set(null);
    this.excludedPullIds.set(new Set());

    const encounter = this.selectedEncounter();
    if (!encounter) {
      return;
    }
    await this.ensurePlayers(encounter);
    const defaultPull = encounter.pulls.find((p) => p.kill) ?? encounter.pulls.at(-1);
    if (defaultPull) {
      await this.selectPull(defaultPull.id);
    }
  }

  async selectPull(fightId: number): Promise<void> {
    this.selectedPullId.set(fightId);
    this.selectedPlayerId.set(null);
    await this.ensureEvents(fightId);
  }

  /** Switches to the player-across-pulls view and loads events for every pull. */
  async selectPlayer(playerId: number): Promise<void> {
    this.selectedPlayerId.set(playerId);
    const excluded = this.excludedPullIds();
    const pulls = (this.selectedEncounter()?.pulls ?? []).filter((p) => !excluded.has(p.id));
    await Promise.all(pulls.map((pull) => this.ensureEvents(pull.id)));
  }

  showPullView(): void {
    this.selectedPlayerId.set(null);
  }

  togglePullExcluded(fightId: number): void {
    const next = new Set(this.excludedPullIds());
    if (!next.delete(fightId)) {
      next.add(fightId);
    }
    this.excludedPullIds.set(next);
    // A pull re-included while in the player view needs its events loaded.
    if (!next.has(fightId) && this.viewMode() === 'player') {
      void this.ensureEvents(fightId);
    }
  }

  toggleRole(role: PlayerRole): void {
    const next = new Set(this.enabledRoles());
    if (!next.delete(role)) {
      next.add(role);
    }
    this.enabledRoles.set(next);
  }

  toggleRoleCollapsed(role: PlayerRole): void {
    const next = new Set(this.collapsedRoles());
    if (!next.delete(role)) {
      next.add(role);
    }
    this.collapsedRoles.set(next);
  }

  /** Boss ability picker: select every ability (null = all) or none. */
  selectAllBossAbilities(all: boolean): void {
    this.selectedBossAbilityIds.set(all ? null : new Set());
  }

  toggleCategory(category: AbilityCategory): void {
    const next = new Set(this.enabledCategories());
    if (!next.delete(category)) {
      next.add(category);
    }
    this.enabledCategories.set(next);
  }

  toggleBossAbility(abilityId: number, allIds: number[]): void {
    const current = this.selectedBossAbilityIds();
    const next = new Set(current ?? allIds);
    if (!next.delete(abilityId)) {
      next.add(abilityId);
    }
    this.selectedBossAbilityIds.set(next.size === allIds.length ? null : next);
  }

  private async ensurePlayers(encounter: EncounterGroup): Promise<void> {
    const report = this.report();
    if (!report || report.code === DEMO_REPORT_CODE) {
      return;
    }
    const key = groupKey(encounter);
    let players = this.playerDetailsCache.get(key);
    if (!players) {
      players = await this.api.fetchPlayerDetails(
        report.code,
        encounter.pulls.map((p) => p.id),
      );
      this.playerDetailsCache.set(key, players);
    }
    this.players.set(players);
  }

  private async ensureEvents(fightId: number): Promise<void> {
    if (this.eventsByFight().get(fightId)) {
      return;
    }
    const existing = this.inflight.get(fightId);
    if (existing) {
      return existing;
    }

    const task = this.fetchEvents(fightId);
    this.inflight.set(fightId, task);
    try {
      await task;
    } finally {
      this.inflight.delete(fightId);
    }
  }

  private async fetchEvents(fightId: number): Promise<void> {
    const report = this.report();
    const fight = report?.fights.find((f) => f.id === fightId);
    if (!report || !fight) {
      return;
    }

    this.loadingFights.update((set) => new Set(set).add(fightId));
    try {
      const events =
        this.demoEvents?.get(fightId) ?? (await this.api.fetchFightEvents(report.code, fight));
      this.eventsByFight.update((map) => new Map(map).set(fightId, events));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load fight events.');
    } finally {
      this.loadingFights.update((set) => {
        const next = new Set(set);
        next.delete(fightId);
        return next;
      });
    }
  }

  private resetSelection(): void {
    this.report.set(null);
    this.players.set([]);
    this.selectedEncounterKey.set(null);
    this.selectedPullId.set(null);
    this.selectedPlayerId.set(null);
    this.selectedBossAbilityIds.set(null);
  }

  private fail(message: string): void {
    this.status.set('error');
    this.error.set(message);
  }
}

export interface BossAbility {
  id: number;
  name: string;
  icon: string | null;
  /** Total casts across the fights currently in view. */
  count: number;
}

export function encounterKey(fight: ReportFight): string {
  return `${fight.encounterID}:${fight.difficulty ?? 0}`;
}

export function groupKey(group: EncounterGroup): string {
  return `${group.encounterID}:${group.difficulty ?? 0}`;
}

export function parseReportCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.toUpperCase() === DEMO_REPORT_CODE) {
    return DEMO_REPORT_CODE;
  }
  const fromUrl = REPORT_URL_PATTERN.exec(trimmed);
  if (fromUrl) {
    return fromUrl[1];
  }
  return /^(?:a:)?[A-Za-z0-9]{10,}$/.test(trimmed) ? trimmed : null;
}
