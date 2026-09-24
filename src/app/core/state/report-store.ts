import { Injectable, computed, inject, signal } from '@angular/core';

import {
  AbilityCategory,
  CATEGORIES,
  CategoryMeta,
  classifyAbility,
} from '../data/ability-catalog';
import { DEMO_REPORT_CODE } from '../data/demo-report';
import { EncounterGroup, FightEvents, PlayerInfo, PlayerRole, ReportFight } from '../models/wcl';
import { ReportDataStore } from './report-data.store';

/** "pull" = one pull, all raiders; "player" = one raider, all pulls. */
export type ViewMode = 'pull' | 'player';

/** Analysis drawer scope. */
export type AnalysisScope = 'pull' | 'all';

const REPORT_URL_PATTERN = /reports\/((?:a:)?[A-Za-z0-9]{10,})/;

export interface PlayerAbility {
  id: number;
  name: string;
  icon: string | null;
  count: number;
}

export interface CategoryAbilities {
  meta: CategoryMeta;
  abilities: PlayerAbility[];
}

export interface BossAbility {
  id: number;
  name: string;
  icon: string | null;
  /** Total casts across the fights currently in view. */
  count: number;
}

/**
 * What the user is currently looking at: which encounter, pull and player are
 * selected, and how the timeline is filtered. Fetched data lives in
 * ReportDataStore, which this re-exposes so components have a single entry point.
 */
@Injectable({ providedIn: 'root' })
export class ReportStore {
  private readonly data = inject(ReportDataStore);

  // --- data passthrough ---
  readonly status = this.data.status;
  readonly error = this.data.error;
  readonly report = this.data.report;
  readonly players = this.data.players;
  readonly events = this.data.events;
  readonly loadingFights = this.data.loadingFights;
  readonly loadingDamage = this.data.loadingDamage;
  readonly damageByFight = this.data.damageByFight;
  readonly dispelsByFight = this.data.dispelsByFight;
  readonly performanceByFight = this.data.performanceByFight;
  readonly healingByFight = this.data.healingByFight;

  eventsFor(fightId: number): FightEvents | null {
    return this.data.eventsFor(fightId);
  }

  ensureEvents(fightId: number): Promise<void> {
    return this.data.ensureEvents(fightId);
  }

  ensureDamage(fightId: number): Promise<void> {
    return this.data.ensureDamage(fightId);
  }

  ensureHealing(fightId: number): Promise<void> {
    return this.data.ensureHealing(fightId);
  }

  ensurePerformance(fightId: number): Promise<void> {
    return this.data.ensurePerformance(fightId);
  }

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
  /** Analysis drawer scope: this pull, or every included pull. */
  readonly analysisScope = signal<AnalysisScope>('pull');
  /** null = all boss abilities visible. */
  readonly selectedBossAbilityIds = signal<ReadonlySet<number> | null>(null);
  readonly pxPerSecond = signal(3);
  /** Individual abilities hidden via their filter-bar icon. */
  readonly disabledAbilityIds = signal<ReadonlySet<number>>(new Set());

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

  /** Pulls of the selected encounter minus the excluded ones. */
  readonly includedPulls = computed<ReportFight[]>(() => {
    const excluded = this.excludedPullIds();
    return (this.selectedEncounter()?.pulls ?? []).filter((p) => !excluded.has(p.id));
  });

  /** Fights whose events feed the current view (one pull, or all pulls in player mode). */
  readonly fightsInView = computed<ReportFight[]>(() => {
    const encounter = this.selectedEncounter();
    if (!encounter) {
      return [];
    }
    if (this.viewMode() === 'player') {
      return this.includedPulls();
    }
    const pull = this.selectedPull();
    return pull ? [pull] : [];
  });

  /** Player abilities seen in the fights in view, grouped by catalog category. */
  readonly abilitiesByCategory = computed<CategoryAbilities[]>(() => {
    const report = this.report();
    if (!report) {
      return [];
    }
    const events = this.events();
    // In the player view only the selected raider's abilities are relevant.
    const onlyPlayerId = this.viewMode() === 'player' ? this.selectedPlayerId() : null;
    const counts = new Map<number, number>();
    for (const fight of this.fightsInView()) {
      for (const cast of events.get(fight.id)?.friendlyCasts ?? []) {
        if (onlyPlayerId !== null && cast.sourceID !== onlyPlayerId) {
          continue;
        }
        counts.set(cast.abilityGameID, (counts.get(cast.abilityGameID) ?? 0) + 1);
      }
    }
    const grouped = new Map<AbilityCategory, PlayerAbility[]>();
    for (const [id, count] of counts) {
      const ability = report.abilities.get(id);
      const category = classifyAbility(id, ability?.name ?? null);
      if (!category) {
        continue;
      }
      const list = grouped.get(category) ?? [];
      list.push({ id, name: ability?.name ?? `#${id}`, icon: ability?.icon ?? null, count });
      grouped.set(category, list);
    }
    return CATEGORIES.map((meta) => ({
      meta,
      abilities: (grouped.get(meta.id) ?? []).sort((a, b) => b.count - a.count),
    }));
  });

  /** Boss/NPC abilities cast during the fights in view, most frequent first. */
  readonly bossAbilities = computed<BossAbility[]>(() => {
    const report = this.report();
    if (!report) {
      return [];
    }
    const events = this.events();
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
        return { id, name: ability?.name ?? `Ability #${id}`, icon: ability?.icon ?? null, count };
      })
      .filter((a) => a.name.toLowerCase() !== 'melee')
      .sort((a, b) => b.count - a.count);
  });

  // --- actions ---

  async loadReport(input: string): Promise<void> {
    const code = parseReportCode(input);
    if (!code) {
      this.data.fail('That does not look like a Warcraft Logs report URL or code.');
      return;
    }

    this.resetSelection();
    if (!(await this.data.loadReport(code))) {
      return;
    }
    const first = this.encounters().at(-1);
    if (first) {
      await this.selectEncounter(groupKey(first));
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
    await this.data.ensurePlayers(
      key,
      encounter.pulls.map((p) => p.id),
    );
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
    await Promise.all(this.includedPulls().map((pull) => this.ensureEvents(pull.id)));
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
    this.enabledRoles.set(toggled(this.enabledRoles(), role));
  }

  toggleRoleCollapsed(role: PlayerRole): void {
    this.collapsedRoles.set(toggled(this.collapsedRoles(), role));
  }

  /** Boss ability picker: select every ability (null = all) or none. */
  selectAllBossAbilities(all: boolean): void {
    this.selectedBossAbilityIds.set(all ? null : new Set());
  }

  /** One-press master switch: any category on → all off; all off → all on. */
  toggleAllCategories(): void {
    this.enabledCategories.set(
      this.enabledCategories().size > 0 ? new Set() : new Set(CATEGORIES.map((c) => c.id)),
    );
  }

  toggleCategory(category: AbilityCategory): void {
    this.enabledCategories.set(toggled(this.enabledCategories(), category));
  }

  toggleBossAbility(abilityId: number, allIds: number[]): void {
    const current = this.selectedBossAbilityIds();
    const next = new Set(current ?? allIds);
    if (!next.delete(abilityId)) {
      next.add(abilityId);
    }
    this.selectedBossAbilityIds.set(next.size === allIds.length ? null : next);
  }

  toggleAbilityDisabled(abilityId: number): void {
    this.disabledAbilityIds.set(toggled(this.disabledAbilityIds(), abilityId));
  }

  /**
   * Icon click in the filter bar. Visible ability → hide it. Hidden ability in
   * an enabled category → show it. Hidden because its whole category is off →
   * enable the category but reveal only this ability.
   */
  toggleAbilityVisibility(
    category: AbilityCategory,
    abilityId: number,
    categoryAbilityIds: number[],
  ): void {
    const categoryOn = this.enabledCategories().has(category);
    const disabled = new Set(this.disabledAbilityIds());

    if (categoryOn) {
      if (!disabled.delete(abilityId)) {
        disabled.add(abilityId);
      }
    } else {
      for (const id of categoryAbilityIds) {
        if (id !== abilityId) {
          disabled.add(id);
        }
      }
      disabled.delete(abilityId);
      this.enabledCategories.set(new Set([...this.enabledCategories(), category]));
    }
    this.disabledAbilityIds.set(disabled);
  }

  private resetSelection(): void {
    this.selectedEncounterKey.set(null);
    this.selectedPullId.set(null);
    this.selectedPlayerId.set(null);
    this.selectedBossAbilityIds.set(null);
    this.disabledAbilityIds.set(new Set());
    this.excludedPullIds.set(new Set());
  }
}

/** Adds the value if absent, removes it if present. */
function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) {
    next.add(value);
  }
  return next;
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
