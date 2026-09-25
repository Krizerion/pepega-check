import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { buildAvoidableRows, heuristicAvoidable } from '../../core/analysis/avoidable';
import { aggregateDamage, buildMechanicGroups } from '../../core/analysis/damage';
import { buildDeathLeaderboard, buildDeathRows } from '../../core/analysis/deaths';
import { buildSummaryMarkdown } from '../../core/analysis/export';
import { buildPhaseWipeRows, phaseWipeHeadline } from '../../core/analysis/phases';
import { buildRaidCooldowns, pullsWithoutLust } from '../../core/analysis/raid-cooldowns';
import { SortState, nextSort, sortRows } from '../../core/analysis/sort';
import {
  AnalysisInput,
  DeathMoment,
  DeathRow,
  RaidCooldownUse,
  RaidCooldowns,
} from '../../core/analysis/types';
import { buildUtilityRows } from '../../core/analysis/utility';
import { classColor } from '../../core/data/wow';
import { NotifyService } from '../../core/notify/notify.service';
import { ReportFight, fightDuration, formatOffset } from '../../core/models/wcl';
import { ReportStore } from '../../core/state/report-store';
import { WowheadLink } from '../../core/wowhead/wowhead-tooltip';

interface PerformanceRow {
  name: string;
  color: string;
  damage: number;
  dps: number;
  healing: number;
  hps: number;
  /** Bar widths relative to the column maximum, 0-100. */
  damagePct: number;
  healingPct: number;
  /** WCL rank percentile (kills only); null when no kill is in scope. */
  parse: number | null;
}

@Component({
  selector: 'app-pull-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WowheadLink],
  templateUrl: './pull-analysis.html',
  styleUrl: './pull-analysis.scss',
  host: {
    '(document:keydown.escape)': 'close()',
    '[class.wide]': 'wide()',
  },
})
export class PullAnalysis {
  protected readonly store = inject(ReportStore);
  private readonly notify = inject(NotifyService);
  protected readonly format = formatOffset;
  /** Shared with the URL so an analysis view can be linked. */
  protected readonly scope = this.store.analysisScope;
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly deathOptions = [1, 2, 3, 4, 5, 8, 10];

  /** Panel stretched to near full width. */
  protected readonly wide = signal(false);

  /**
   * Count absorbed damage towards mechanic totals. Off by default: absorbs
   * inflate "avoidable damage" for shielded players even though the hit was
   * soaked rather than taken.
   */
  protected readonly includeAbsorbed = signal(false);

  // Per-table sort states.
  protected readonly perfSort = signal<SortState>({ key: 'damage', dir: -1 });
  protected readonly utilSort = signal<SortState>({ key: 'name', dir: 1 });
  protected readonly boardSort = signal<SortState>({ key: 'deaths', dir: -1 });
  protected readonly mechSort = signal<SortState>({ key: 'name', dir: 1 });
  protected readonly avoidSort = signal<SortState>({ key: 'damage', dir: -1 });
  protected readonly phaseSort = signal<SortState>({ key: 'phase', dir: 1 });

  /** Collapsed section ids; sections are open unless listed here. */
  private readonly collapsed = signal<ReadonlySet<string>>(new Set());

  constructor() {
    // Publish the sticky header's height so table headers can clear it.
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const top = host.querySelector('.panel-top');
      if (!top) {
        return;
      }
      const observer = new ResizeObserver(([entry]) => {
        host.style.setProperty('--top-h', `${Math.round(entry.contentRect.height)}px`);
      });
      observer.observe(top);
      destroyRef.onDestroy(() => observer.disconnect());
    });

    /**
     * Healing is the chattiest event stream in a log, and only the per-pull
     * death log reads it — so it loads for the selected pull alone, never for
     * every pull in the encounter.
     */
    effect(() => {
      const pull = this.store.selectedPull();
      const open = this.store.showAnalysis();
      untracked(() => {
        if (pull && open) {
          void this.store.ensureHealing(pull.id);
        }
      });
    });

    // Lazily pull damage (and, for the all-pulls tab, cast/death) events.
    effect(() => {
      const fights = this.scopeFights();
      const scope = this.scope();
      untracked(() => {
        for (const fight of fights) {
          void this.store.ensureDamage(fight.id);
          void this.store.ensurePerformance(fight.id);
          if (scope === 'all') {
            void this.store.ensureEvents(fight.id);
          }
        }
      });
    });
  }

  // --- scope ---

  protected readonly scopeFights = computed<ReportFight[]>(() => {
    if (this.scope() === 'all') {
      return this.store.includedPulls();
    }
    const pull = this.store.selectedPull();
    return pull ? [pull] : [];
  });

  protected readonly ready = computed(() => {
    const damage = this.store.damageByFight();
    const events = this.store.events();
    const needEvents = this.scope() === 'all';
    return this.scopeFights().every((f) => damage.has(f.id) && (!needEvents || events.has(f.id)));
  });

  /** Everything the pure analysis functions need, assembled from the store. */
  private readonly input = computed<AnalysisInput | null>(() => {
    const report = this.store.report();
    if (!report) {
      return null;
    }
    return {
      fights: this.scopeFights(),
      players: this.store.players(),
      abilities: report.abilities,
      actors: report.actors,
      events: this.store.events(),
      damage: this.store.damageByFight(),
      dispels: this.store.dispelsByFight(),
      healing: this.store.healingByFight(),
      ignoreAfterDeaths: this.store.ignoreAfterDeaths(),
    };
  });

  protected readonly title = computed(() => {
    if (this.scope() === 'all') {
      return `${this.store.selectedEncounter()?.name ?? 'Encounter'} — all pulls`;
    }
    const pull = this.store.selectedPull();
    const pulls = this.store.selectedEncounter()?.pulls ?? [];
    const index = pull ? pulls.findIndex((p) => p.id === pull.id) + 1 : 0;
    return `Pull ${index}`;
  });

  protected readonly subtitle = computed(() => {
    const fights = this.scopeFights();
    if (this.scope() === 'all') {
      const kills = fights.filter((f) => f.kill).length;
      const time = formatOffset(fights.reduce((sum, f) => sum + fightDuration(f), 0));
      return `${fights.length} pulls · ${kills} kill${kills === 1 ? '' : 's'} · ${time} total`;
    }
    const pull = this.store.selectedPull();
    if (!pull) {
      return '';
    }
    const outcome = pull.kill
      ? 'Kill'
      : `Wipe at ${Math.round(pull.fightPercentage ?? 0)}%` +
        (pull.lastPhase !== null ? ` · P${pull.lastPhase}` : '');
    return `${formatOffset(fightDuration(pull))} · ${outcome}`;
  });

  // --- derived analysis ---

  private readonly aggregate = computed(() => {
    const input = this.input();
    return input ? aggregateDamage(input, this.includeAbsorbed()) : null;
  });

  protected readonly mechanicGroups = computed(() => {
    const input = this.input();
    const aggregate = this.aggregate();
    return input && aggregate ? buildMechanicGroups(input, aggregate) : [];
  });

  /** Explicit user decisions, overriding the default heuristic per ability. */
  private readonly avoidableOverrides = signal<ReadonlyMap<number, boolean>>(new Map());

  private readonly heuristic = computed(() => {
    const input = this.input();
    const aggregate = this.aggregate();
    return input && aggregate ? heuristicAvoidable(aggregate, input) : new Set<number>();
  });

  protected isAvoidable(abilityId: number): boolean {
    return this.avoidableOverrides().get(abilityId) ?? this.heuristic().has(abilityId);
  }

  protected toggleAvoidable(abilityId: number): void {
    const next = new Map(this.avoidableOverrides());
    next.set(abilityId, !this.isAvoidable(abilityId));
    this.avoidableOverrides.set(next);
  }

  protected resetAvoidable(): void {
    this.avoidableOverrides.set(new Map());
  }

  protected readonly avoidable = computed(() => {
    const input = this.input();
    const aggregate = this.aggregate();
    if (!input || !aggregate) {
      return [];
    }
    return buildAvoidableRows(input, aggregate, (id) => this.isAvoidable(id));
  });

  protected readonly avoidableTotal = computed(() =>
    this.avoidable().reduce((sum, row) => sum + row.damage, 0),
  );

  /** Raid-wide cooldowns: the haste buff and battle rezzes. */
  protected readonly raidCooldowns = computed<RaidCooldowns>(() => {
    const input = this.input();
    return input ? buildRaidCooldowns(input) : { lust: [], battleRez: [], byCaster: [] };
  });

  /** Pulls in scope that never got the haste buff, as pull numbers. */
  protected readonly noLustPulls = computed(() =>
    pullsWithoutLust(this.scopeFights(), this.raidCooldowns().lust).map((id) =>
      this.pullNumber(id),
    ),
  );

  /** "Pull 7" for a fight id, using the encounter's own numbering. */
  protected pullNumber(fightId: number): number {
    const pulls = this.store.selectedEncounter()?.pulls ?? [];
    return pulls.findIndex((p) => p.id === fightId) + 1;
  }

  /** "Pull 7 · 2:14" — where a raid cooldown was pressed. */
  protected useWhen(use: RaidCooldownUse): string {
    const at = formatOffset(use.timeMs);
    return this.scope() === 'all' ? `Pull ${this.pullNumber(use.fightId)} · ${at}` : at;
  }

  protected readonly deathRows = computed(() => {
    const input = this.input();
    const pull = this.store.selectedPull();
    if (!input || !pull) {
      return [];
    }
    // Knowing a player's kit needs every pull, not just the selected one.
    return buildDeathRows(pull, input, this.store.includedPulls());
  });

  protected readonly deathLeaderboard = computed(() => {
    const input = this.input();
    return input ? buildDeathLeaderboard(input) : [];
  });

  protected readonly utility = computed(() => {
    const input = this.input();
    return input ? buildUtilityRows(input) : [];
  });

  /**
   * Where pulls end, across the whole encounter. Only meaningful with more than
   * one pull in scope, so the single-pull tab leaves it out.
   */
  protected readonly phaseRows = computed(() => {
    const input = this.input();
    return input && this.scope() === 'all' ? buildPhaseWipeRows(input) : [];
  });

  /** Overall damage/healing per raider across the scope, with kill parses. */
  protected readonly performance = computed<PerformanceRow[]>(() => {
    const perf = this.store.performanceByFight();
    const fights = this.scopeFights();
    const totalSeconds = Math.max(1, fights.reduce((sum, f) => sum + fightDuration(f), 0) / 1000);

    const totals = new Map<number, { damage: number; healing: number }>();
    const parseSums = new Map<string, { sum: number; count: number }>();
    let anyLoaded = false;

    for (const fight of fights) {
      const data = perf.get(fight.id);
      if (!data) {
        continue;
      }
      anyLoaded = true;
      for (const entry of data.entries) {
        const t = totals.get(entry.actorId) ?? { damage: 0, healing: 0 };
        t.damage += entry.damage;
        t.healing += entry.healing;
        totals.set(entry.actorId, t);
      }
      if (data.parses) {
        for (const [name, parse] of Object.entries(data.parses)) {
          const p = parseSums.get(name) ?? { sum: 0, count: 0 };
          p.sum += parse;
          p.count++;
          parseSums.set(name, p);
        }
      }
    }
    if (!anyLoaded) {
      return [];
    }

    const rows = this.store.players().map((player) => {
      const t = totals.get(player.id) ?? { damage: 0, healing: 0 };
      const p = parseSums.get(player.name);
      return {
        name: player.name,
        color: classColor(player.className),
        damage: t.damage,
        dps: t.damage / totalSeconds,
        healing: t.healing,
        hps: t.healing / totalSeconds,
        damagePct: 0,
        healingPct: 0,
        parse: p ? Math.round(p.sum / p.count) : null,
      };
    });
    const maxDamage = Math.max(1, ...rows.map((r) => r.damage));
    const maxHealing = Math.max(1, ...rows.map((r) => r.healing));
    for (const row of rows) {
      row.damagePct = Math.round((row.damage / maxDamage) * 100);
      row.healingPct = Math.round((row.healing / maxHealing) * 100);
    }
    return rows;
  });

  protected readonly hasParses = computed(() => this.performance().some((r) => r.parse !== null));

  /**
   * True when a death cutoff is set but cannot apply to the performance totals:
   * those come from Warcraft Logs' summary tables, which always cover the whole
   * fight. Every other section in this panel honours the cutoff.
   */
  protected readonly performanceIgnoresCutoff = computed(
    () => this.store.ignoreAfterDeaths() !== null,
  );

  protected readonly summary = computed<string[]>(() => {
    if (this.scope() === 'all') {
      const headline = phaseWipeHeadline(this.phaseRows());
      return headline ? [headline] : [];
    }
    const pull = this.store.selectedPull();
    if (!pull) {
      return [];
    }
    const deaths = this.deathRows();
    const lines: string[] = [];
    const duration = formatOffset(fightDuration(pull));

    if (pull.kill) {
      lines.push(`Kill after ${duration} with ${deaths.length} deaths. 🎉`);
    } else {
      const pct =
        pull.fightPercentage !== null ? ` — boss at ${Math.round(pull.fightPercentage)}%` : '';
      const phase = pull.lastPhase !== null ? ` (P${pull.lastPhase})` : '';
      lines.push(`Wiped at ${duration}${pct}${phase}.`);
    }

    if (deaths.length === 0) {
      lines.push('No deaths this pull.');
      return lines;
    }

    const first = deaths[0];
    const firstMitigation = first.mitigation
      ? `after using ${first.mitigation.name} ${first.mitigation.secondsBefore}s earlier`
      : 'with no defensive or health pot in the 12s before';
    lines.push(
      `First blood: ${first.playerName} at ${formatOffset(first.timeMs)} to ${first.abilityName}, ${firstMitigation}.`,
    );

    const killCounts = new Map<string, number>();
    for (const death of deaths) {
      killCounts.set(death.abilityName, (killCounts.get(death.abilityName) ?? 0) + 1);
    }
    const [topAbility, topCount] = [...killCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCount >= 2) {
      lines.push(`Deadliest mechanic: ${topAbility} (${topCount} deaths).`);
    }

    return lines;
  });

  // --- sorted views ---

  protected readonly sortedPerformance = computed(() =>
    sortRows(this.performance(), this.perfSort()),
  );
  protected readonly sortedUtility = computed(() => sortRows(this.utility(), this.utilSort()));
  protected readonly sortedLeaderboard = computed(() =>
    sortRows(this.deathLeaderboard(), this.boardSort()),
  );
  protected readonly sortedAvoidable = computed(() => sortRows(this.avoidable(), this.avoidSort()));
  protected readonly sortedPhases = computed(() => sortRows(this.phaseRows(), this.phaseSort()));
  protected readonly sortedMechanicGroups = computed(() => {
    const sort = this.mechSort();
    return this.mechanicGroups().map((group) => ({
      ...group,
      mechanics: sortRows(group.mechanics, sort),
    }));
  });

  // --- UI state ---

  protected isOpen(section: string): boolean {
    return !this.collapsed().has(section);
  }

  protected toggleSection(section: string): void {
    const next = new Set(this.collapsed());
    if (!next.delete(section)) {
      next.add(section);
    }
    this.collapsed.set(next);
  }

  /** All section ids currently rendered, for collapse/expand all. */
  protected readonly sectionIds = computed(() => [
    ...(this.phaseRows().length > 0 ? ['phases'] : []),
    'performance',
    'avoidable',
    ...this.mechanicGroups().map((g) => `mech:${g.phase}`),
    'utility',
    'deaths',
  ]);

  protected readonly allCollapsed = computed(() => {
    const collapsed = this.collapsed();
    return this.sectionIds().every((id) => collapsed.has(id));
  });

  protected toggleAllSections(): void {
    this.collapsed.set(this.allCollapsed() ? new Set() : new Set(this.sectionIds()));
  }

  protected sortBy(state: typeof this.perfSort, key: string): void {
    state.set(nextSort(state(), key));
  }

  protected arrow(state: SortState, key: string): string {
    return state.key === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
  }

  protected close(): void {
    this.store.showAnalysis.set(false);
  }

  protected toggleExpanded(key: string): void {
    const next = new Set(this.expanded());
    if (!next.delete(key)) {
      next.add(key);
    }
    this.expanded.set(next);
  }

  protected asSelect(event: Event): HTMLSelectElement {
    return event.target as HTMLSelectElement;
  }

  protected setIgnoreDeaths(value: string): void {
    this.store.ignoreAfterDeaths.set(value === '' ? null : Number(value));
  }

  protected fmt(value: number): string {
    // Belt and braces: a single event with no amount used to poison a total
    // and render as "NaN" in the UI.
    if (!Number.isFinite(value)) {
      return '0';
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)}m`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(2)}k`;
    }
    return `${Math.round(value)}`;
  }

  /** WCL-style parse colors. */
  protected parseColor(parse: number): string {
    if (parse >= 100) return '#e5cc80';
    if (parse >= 99) return '#e268a8';
    if (parse >= 95) return '#ff8000';
    if (parse >= 75) return '#a335ee';
    if (parse >= 50) return '#0070dd';
    if (parse >= 25) return '#1eff00';
    return '#8b8b98';
  }

  /** Whole seconds before the death, for the step list. */
  protected seconds(beforeMs: number): string {
    return (beforeMs / 1000).toFixed(1);
  }

  /** True once healing for the selected pull has arrived. */
  protected readonly healingLoaded = computed(() => {
    const pull = this.store.selectedPull();
    return pull ? this.store.healingByFight().has(pull.id) : false;
  });

  /**
   * True when healing for this pull was tried and failed. Without it the
   * "loading" state below is indistinguishable from a dead fetch, and the
   * spinner spins for as long as the panel is open.
   */
  protected readonly healingFailed = computed(() => {
    const pull = this.store.selectedPull();
    return pull ? this.store.failedHealing().has(pull.id) : false;
  });

  protected retryHealing(): void {
    const pull = this.store.selectedPull();
    if (pull) {
      this.store.retryHealing(pull.id);
    }
  }

  /** The health trace as an SVG polyline, in a 100x100 viewBox. */
  protected tracePoints(row: DeathRow): string {
    return row.hpTrace.map((point) => `${point.x},${100 - point.y}`).join(' ');
  }

  /** The same trace closed along the bottom, so it can be filled. */
  protected traceArea(row: DeathRow): string {
    if (row.hpTrace.length === 0) {
      return '';
    }
    const first = row.hpTrace[0];
    const last = row.hpTrace[row.hpTrace.length - 1];
    return `${first.x},100 ${this.tracePoints(row)} ${last.x},100`;
  }

  /** Red below a quarter health, amber below half — the colour of the number. */
  /** "Opened the window at 412k of 450k (92%)", for the trace's start label. */
  protected hpStartTitle(row: DeathRow): string {
    if (row.hpStart === null) {
      return '';
    }
    const absolute =
      row.hpStartRaw !== null && row.maxHp !== null
        ? ` — ${this.fmt(row.hpStartRaw)} of ${this.fmt(row.maxHp)}`
        : '';
    return `Health 12s before the death: ${row.hpStart}%${absolute}`;
  }

  protected hpColor(pct: number | null): string {
    if (pct === null) {
      return 'var(--text-2)';
    }
    if (pct <= 25) {
      return 'var(--danger)';
    }
    if (pct <= 50) {
      return 'var(--warn)';
    }
    return 'var(--success)';
  }

  protected momentTitle(moment: DeathMoment): string {
    const at = `${this.seconds(moment.beforeMs)}s before death`;
    const hp =
      moment.hpBefore !== null && moment.hpAfter !== null
        ? ` · ${moment.hpBefore}% → ${moment.hpAfter}%`
        : '';
    if (moment.kind === 'cast') {
      return `${moment.name} — pressed ${at}`;
    }
    if (moment.kind === 'heal') {
      return `${moment.sourceName ?? 'Healer'} healed ${this.fmt(moment.amount)} ${at}${hp}`;
    }
    return (
      `${moment.name} — ${this.fmt(moment.amount)} damage, ${at}${hp}` +
      (moment.fatal ? ' (killing blow)' : '')
    );
  }

  protected onIconError(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }

  // --- export ---

  /** 'idle' | 'copied' | 'failed', shown on the copy button. */
  protected readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');

  protected async copySummary(): Promise<void> {
    const text = buildSummaryMarkdown({
      title: this.title(),
      subtitle: this.subtitle(),
      url: window.location.href,
      scope: this.scope(),
      summary: this.summary(),
      deaths: this.deathRows(),
      leaderboard: this.deathLeaderboard(),
      avoidable: this.avoidable(),
      utility: this.utility(),
    });

    try {
      await navigator.clipboard.writeText(text);
      this.copyState.set('copied');
      this.notify.success('Summary copied — paste it straight into Discord.');
    } catch {
      this.copyState.set('failed');
      // Usually a browser refusing clipboard access without a user gesture.
      this.notify.error(
        'The browser blocked clipboard access. Select the summary manually instead.',
        'Could not copy',
      );
    }
    setTimeout(() => this.copyState.set('idle'), 2000);
  }
}
