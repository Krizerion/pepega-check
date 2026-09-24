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

import { ABILITY_COOLDOWNS, classifyAbility } from '../../core/data/ability-catalog';
import { abilityIconUrl, classColor } from '../../core/data/wow';
import {
  DeathEvent,
  ReportFight,
  fightDuration,
  formatOffset,
  killingAbilityId,
} from '../../core/models/wcl';
import { ReportStore } from '../../core/state/report-store';
import { WowheadLink } from '../../core/wowhead/wowhead-tooltip';

/** Categories that count as "tried to survive" right before a death. */
const MITIGATION_CATEGORIES = new Set(['defensive', 'immunity', 'health-pot', 'raid-cd']);
const MITIGATION_WINDOW_MS = 12_000;

/**
 * A mechanic is treated as avoidable by default when a single cast of it hits
 * fewer than this share of the raid on average — raid-wide damage is
 * unavoidable, a few people eating it usually is not. Tank-only mechanics are
 * excluded as tankbusters.
 */
const AVOIDABLE_RAID_SHARE = 0.5;

/** Hits of one ability closer together than this belong to the same cast. */
const OCCURRENCE_GAP_MS = 1_500;

type AnalysisScope = 'pull' | 'all';

interface DeathRow {
  timeMs: number;
  playerId: number;
  playerName: string;
  playerColor: string;
  abilityName: string;
  abilityIcon: string;
  abilityUrl: string | null;
  mitigation: { name: string; icon: string; secondsBefore: number } | null;
  /** Survival abilities known to be off cooldown when the player died. */
  available: { id: number; name: string; icon: string }[];
}

interface UtilityRow {
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

interface PlayerHits {
  name: string;
  color: string;
  damage: number;
  hits: number;
  /** Bar width relative to the hardest-hit player, 0-100. */
  pct: number;
}

interface MechanicRow {
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

interface PhaseGroup {
  phase: number;
  /** null = single unlabelled group (fight has no phases). */
  label: string | null;
  mechanics: MechanicRow[];
}

interface LeaderboardRow {
  name: string;
  color: string;
  deaths: number;
  unmitigated: number;
}

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

interface AvoidableMechanic {
  id: number;
  name: string;
  icon: string;
  url: string;
  damage: number;
  hits: number;
  /** Bar width relative to this player's worst mechanic, 0-100. */
  pct: number;
}

interface AvoidableRow {
  name: string;
  color: string;
  damage: number;
  hits: number;
  /** Average per pull in the current scope. */
  perPull: number;
  /** Bar width relative to the worst raider, 0-100. */
  pct: number;
  mechanics: AvoidableMechanic[];
}

/** Per-ability damage aggregate over the fights in scope. */
interface Agg {
  hits: number;
  total: number;
  byPlayer: Map<number, { damage: number; hits: number }>;
  /** Distinct casts (hit clusters), used to judge how wide a mechanic spreads. */
  occurrences: number;
}

interface SortState {
  key: string;
  dir: 1 | -1;
}

/** Generic column sort; strings compare alphabetically, null sorts last. */
function sortRows<T>(rows: T[], sort: SortState): T[] {
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sort.key];
    const bv = (b as Record<string, unknown>)[sort.key];
    if (typeof av === 'string' && typeof bv === 'string') {
      return av.localeCompare(bv) * sort.dir;
    }
    return (((av as number | null) ?? -1) - ((bv as number | null) ?? -1)) * sort.dir;
  });
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
  protected readonly format = formatOffset;
  protected readonly scope = signal<AnalysisScope>('pull');
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

  /** Collapsed section ids; sections are open unless listed here. */
  private readonly collapsed = signal<ReadonlySet<string>>(new Set());

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
    const current = state();
    state.set(
      current.key === key
        ? { key, dir: (current.dir * -1) as 1 | -1 }
        : { key, dir: key === 'name' ? 1 : -1 },
    );
  }

  protected arrow(state: SortState, key: string): string {
    return state.key === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
  }

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

  /**
   * Single pass over the damage-taken events in scope, aggregated per phase and
   * (phase-independently) per ability. Both the mechanic tables and the
   * avoidable-damage table read from this.
   */
  private readonly damageAggregate = computed(() => {
    const report = this.store.report();
    const byPhase = new Map<number, Map<number, Agg>>();
    const byAbility = new Map<number, Agg>();
    let sawTransitions = false;
    if (!report) {
      return { byPhase, byAbility, sawTransitions };
    }

    const damage = this.store.damageByFight();
    const absorbed = this.includeAbsorbed();
    const players = new Map(this.store.players().map((p) => [p.id, p]));
    // Only true enemy mechanics: damage sourced by NPCs, not player self-damage
    // (Fel Armor, Burning Rush, trinkets…) or environment effects.
    const npcSources = new Set(
      report.actors.filter((a) => a.type === 'NPC' && a.name !== 'Environment').map((a) => a.id),
    );

    const record = (agg: Agg, targetId: number, amount: number) => {
      agg.hits++;
      agg.total += amount;
      const p = agg.byPlayer.get(targetId) ?? { damage: 0, hits: 0 };
      p.damage += amount;
      p.hits++;
      agg.byPlayer.set(targetId, p);
    };
    const emptyAgg = (): Agg => ({ hits: 0, total: 0, byPlayer: new Map(), occurrences: 0 });

    for (const fight of this.scopeFights()) {
      const cutoff = this.cutoffFor(fight);
      // Last hit timestamp per ability, to split hits into distinct casts.
      const lastHitAt = new Map<number, number>();
      const transitions = (fight.phaseTransitions ?? [])
        .slice()
        .sort((a, b) => a.startTime - b.startTime);
      if (transitions.length > 1) {
        sawTransitions = true;
      }
      const phaseOf = (timestamp: number): number => {
        let phase = 1;
        for (const t of transitions) {
          if (t.startTime <= timestamp) {
            phase = t.id;
          }
        }
        return phase;
      };

      for (const event of damage.get(fight.id) ?? []) {
        if (event.abilityGameID <= 1 || !players.has(event.targetID)) {
          continue;
        }
        if (event.sourceID === null || !npcSources.has(event.sourceID)) {
          continue;
        }
        if (cutoff !== null && event.timestamp > cutoff) {
          continue;
        }
        const amount = event.amount + (absorbed ? (event.absorbed ?? 0) : 0);

        const phase = phaseOf(event.timestamp);
        let abilities = byPhase.get(phase);
        if (!abilities) {
          abilities = new Map();
          byPhase.set(phase, abilities);
        }
        let phaseAgg = abilities.get(event.abilityGameID);
        if (!phaseAgg) {
          phaseAgg = emptyAgg();
          abilities.set(event.abilityGameID, phaseAgg);
        }
        record(phaseAgg, event.targetID, amount);

        let totalAgg = byAbility.get(event.abilityGameID);
        if (!totalAgg) {
          totalAgg = emptyAgg();
          byAbility.set(event.abilityGameID, totalAgg);
        }
        const previous = lastHitAt.get(event.abilityGameID);
        if (previous === undefined || event.timestamp - previous > OCCURRENCE_GAP_MS) {
          totalAgg.occurrences++;
        }
        lastHitAt.set(event.abilityGameID, event.timestamp);
        record(totalAgg, event.targetID, amount);
      }
    }

    return { byPhase, byAbility, sawTransitions };
  });

  /** Wipefest-style mechanic tables from damage-taken events, grouped by phase. */
  protected readonly mechanicGroups = computed<PhaseGroup[]>(() => {
    const report = this.store.report();
    if (!report) {
      return [];
    }
    const players = new Map(this.store.players().map((p) => [p.id, p]));
    const { byPhase, sawTransitions } = this.damageAggregate();

    const groups = [...byPhase.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([phase, abilities]) => ({
        phase,
        label: null as string | null,
        mechanics: [...abilities.entries()]
          .map(([id, agg]) => this.toMechanicRow(phase, id, agg, report, players))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
    if (groups.length > 1 || sawTransitions) {
      for (const group of groups) {
        group.label = `Phase ${group.phase}`;
      }
    }
    return groups;
  });

  // --- avoidable damage ---

  /** Explicit user decisions, overriding the default heuristic per ability. */
  private readonly avoidableOverrides = signal<ReadonlyMap<number, boolean>>(new Map());

  /** Abilities the heuristic flags as avoidable, before user overrides. */
  private readonly heuristicAvoidable = computed<ReadonlySet<number>>(() => {
    const { byAbility } = this.damageAggregate();
    const tanks = new Set(
      this.store
        .players()
        .filter((p) => p.role === 'tank')
        .map((p) => p.id),
    );
    const raidSize = Math.max(1, this.store.players().length);
    const flagged = new Set<number>();

    for (const [id, agg] of byAbility) {
      const hitIds = [...agg.byPlayer.keys()];
      const tankOnly = hitIds.length > 0 && hitIds.every((playerId) => tanks.has(playerId));
      // How many raiders a single cast catches on average.
      const perCast = agg.hits / Math.max(1, agg.occurrences);
      if (!tankOnly && perCast < raidSize * AVOIDABLE_RAID_SHARE) {
        flagged.add(id);
      }
    }
    return flagged;
  });

  protected isAvoidable(abilityId: number): boolean {
    return this.avoidableOverrides().get(abilityId) ?? this.heuristicAvoidable().has(abilityId);
  }

  protected toggleAvoidable(abilityId: number): void {
    const next = new Map(this.avoidableOverrides());
    next.set(abilityId, !this.isAvoidable(abilityId));
    this.avoidableOverrides.set(next);
  }

  protected resetAvoidable(): void {
    this.avoidableOverrides.set(new Map());
  }

  /** Avoidable damage taken per raider, broken down by mechanic. */
  protected readonly avoidable = computed<AvoidableRow[]>(() => {
    const report = this.store.report();
    if (!report) {
      return [];
    }
    const { byAbility } = this.damageAggregate();
    const pullCount = Math.max(1, this.scopeFights().length);
    const perPlayer = new Map<
      number,
      { damage: number; hits: number; mechanics: AvoidableMechanic[] }
    >();

    for (const [id, agg] of byAbility) {
      if (!this.isAvoidable(id)) {
        continue;
      }
      const ability = report.abilities.get(id);
      for (const [playerId, stats] of agg.byPlayer) {
        const entry = perPlayer.get(playerId) ?? { damage: 0, hits: 0, mechanics: [] };
        entry.damage += stats.damage;
        entry.hits += stats.hits;
        entry.mechanics.push({
          id,
          name: ability?.name ?? `Ability #${id}`,
          icon: abilityIconUrl(ability?.icon),
          url: `https://www.wowhead.com/spell=${id}`,
          damage: stats.damage,
          hits: stats.hits,
          pct: 0,
        });
        perPlayer.set(playerId, entry);
      }
    }

    const rows = this.store
      .players()
      .filter((player) => perPlayer.has(player.id))
      .map((player) => {
        const entry = perPlayer.get(player.id)!;
        const mechanics = entry.mechanics.sort((a, b) => b.damage - a.damage);
        const worst = mechanics[0]?.damage ?? 1;
        for (const mechanic of mechanics) {
          mechanic.pct = Math.max(2, Math.round((mechanic.damage / worst) * 100));
        }
        return {
          name: player.name,
          color: classColor(player.className),
          damage: entry.damage,
          hits: entry.hits,
          perPull: entry.damage / pullCount,
          pct: 0,
          mechanics,
        };
      });

    const max = Math.max(1, ...rows.map((r) => r.damage));
    for (const row of rows) {
      row.pct = Math.round((row.damage / max) * 100);
    }
    return rows;
  });

  protected readonly sortedAvoidable = computed(() => sortRows(this.avoidable(), this.avoidSort()));

  protected readonly avoidableTotal = computed(() =>
    this.avoidable().reduce((sum, row) => sum + row.damage, 0),
  );

  private toMechanicRow(
    phase: number,
    id: number,
    agg: { hits: number; total: number; byPlayer: Map<number, { damage: number; hits: number }> },
    report: NonNullable<ReturnType<ReportStore['report']>>,
    players: Map<number, { name: string; className: string }>,
  ): MechanicRow {
    const ability = report.abilities.get(id);
    const perPlayer = [...agg.byPlayer.entries()]
      .map(([playerId, stats]) => {
        const player = players.get(playerId);
        return {
          name: player?.name ?? `#${playerId}`,
          color: player ? classColor(player.className) : 'var(--text-1)',
          damage: stats.damage,
          hits: stats.hits,
          pct: 0,
        };
      })
      .sort((a, b) => b.damage - a.damage);
    const max = perPlayer[0]?.damage ?? 1;
    for (const row of perPlayer) {
      row.pct = Math.max(2, Math.round((row.damage / max) * 100));
    }
    return {
      key: `${phase}:${id}`,
      id,
      name: ability?.name ?? `Ability #${id}`,
      icon: abilityIconUrl(ability?.icon),
      url: `https://www.wowhead.com/spell=${id}`,
      hits: agg.hits,
      playersHit: agg.byPlayer.size,
      totalDamage: agg.total,
      avgHit: Math.round(agg.total / agg.hits),
      perPlayer,
    };
  }

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

  protected readonly sortedPerformance = computed(() =>
    sortRows(this.performance(), this.perfSort()),
  );

  protected readonly sortedUtility = computed(() => sortRows(this.utility(), this.utilSort()));

  protected readonly sortedLeaderboard = computed(() =>
    sortRows(this.deathLeaderboard(), this.boardSort()),
  );

  protected readonly sortedMechanicGroups = computed(() => {
    const sort = this.mechSort();
    return this.mechanicGroups().map((group) => ({
      ...group,
      mechanics: sortRows(group.mechanics, sort),
    }));
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

  /** Per-raider survival and utility activity across the scope, cutoff-aware. */
  protected readonly utility = computed<UtilityRow[]>(() => {
    const report = this.store.report();
    if (!report) {
      return [];
    }
    const events = this.store.events();
    const dispelEvents = this.store.dispelsByFight();
    const blank = () => ({
      defensives: 0,
      raidCds: 0,
      combatPots: 0,
      healthPots: 0,
      dispels: 0,
      deaths: 0,
    });
    const counts = new Map<number, ReturnType<typeof blank>>();
    const rowFor = (id: number) => {
      const existing = counts.get(id);
      if (existing) {
        return existing;
      }
      const created = blank();
      counts.set(id, created);
      return created;
    };

    for (const fight of this.scopeFights()) {
      const cutoff = this.cutoffFor(fight);
      const fightEvents = events.get(fight.id);

      for (const cast of fightEvents?.friendlyCasts ?? []) {
        if (cutoff !== null && cast.timestamp > cutoff) {
          continue;
        }
        const ability = report.abilities.get(cast.abilityGameID);
        const category = classifyAbility(cast.abilityGameID, ability?.name ?? null);
        if (!category) {
          continue;
        }
        const row = rowFor(cast.sourceID);
        switch (category) {
          case 'defensive':
          case 'immunity':
            row.defensives++;
            break;
          case 'raid-cd':
            row.raidCds++;
            break;
          case 'combat-pot':
            row.combatPots++;
            break;
          case 'health-pot':
            row.healthPots++;
            break;
        }
      }

      // Successful dispels only — failed dispel casts never produce these events.
      for (const dispel of dispelEvents.get(fight.id) ?? []) {
        if (cutoff !== null && dispel.timestamp > cutoff) {
          continue;
        }
        rowFor(dispel.sourceID).dispels++;
      }

      for (const death of fightEvents?.deaths ?? []) {
        if (cutoff !== null && death.timestamp > cutoff) {
          continue;
        }
        rowFor(death.targetID).deaths++;
      }
    }

    const roleOrder: Record<string, number> = { tank: 0, healer: 1, dps: 2 };
    return this.store
      .players()
      .slice()
      .sort(
        (a, b) =>
          (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3) || a.name.localeCompare(b.name),
      )
      .map((player) => ({
        name: player.name,
        color: classColor(player.className),
        ...(counts.get(player.id) ?? blank()),
      }));
  });

  /** Absolute timestamp of the Nth death in a fight, per the ignore-after setting. */
  private cutoffFor(fight: ReportFight): number | null {
    const n = this.store.ignoreAfterDeaths();
    if (n === null) {
      return null;
    }
    const deaths = this.store.events().get(fight.id)?.deaths;
    if (!deaths || deaths.length < n) {
      return null;
    }
    const sorted = [...deaths].sort((a, b) => a.timestamp - b.timestamp);
    return sorted[n - 1].timestamp;
  }

  protected readonly deathRows = computed<DeathRow[]>(() => {
    const pull = this.store.selectedPull();
    return pull ? this.buildDeathRows(pull) : [];
  });

  /** All-pulls tab: deaths per player, with how many had nothing pressed. */
  protected readonly deathLeaderboard = computed<LeaderboardRow[]>(() => {
    const rows = new Map<number, LeaderboardRow>();
    for (const fight of this.scopeFights()) {
      for (const death of this.buildDeathRows(fight)) {
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
  });

  protected readonly summary = computed<string[]>(() => {
    const pull = this.store.selectedPull();
    if (!pull || this.scope() !== 'pull') {
      return [];
    }
    const deaths = this.deathRows();
    const lines: string[] = [];
    const duration = formatOffset(pull.endTime - pull.startTime);

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
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)}m`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(2)}k`;
    }
    return `${Math.round(value)}`;
  }

  protected onIconError(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }

  private buildDeathRows(fight: ReportFight): DeathRow[] {
    const report = this.store.report();
    const events = this.store.events().get(fight.id);
    if (!report || !events) {
      return [];
    }

    const cutoff = this.cutoffFor(fight);
    const players = new Map(this.store.players().map((p) => [p.id, p]));
    const actors = new Map(report.actors.map((a) => [a.id, a]));
    return [...events.deaths]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((death) => cutoff === null || death.timestamp <= cutoff)
      .map((death) => {
        const player = players.get(death.targetID);
        const abilityId = killingAbilityId(death);
        const killer = abilityId !== null ? report.abilities.get(abilityId) : null;
        const killerActor = death.killerID != null ? actors.get(death.killerID) : null;

        return {
          timeMs: death.timestamp - fight.startTime,
          playerId: death.targetID,
          playerName: player?.name ?? `#${death.targetID}`,
          playerColor: player ? classColor(player.className) : 'var(--text-1)',
          abilityName:
            killer?.name ?? (killerActor ? `${killerActor.name} (melee/unknown)` : 'Unknown'),
          abilityIcon: abilityIconUrl(killer?.icon),
          abilityUrl:
            abilityId !== null && abilityId > 1
              ? `https://www.wowhead.com/spell=${abilityId}`
              : null,
          mitigation: this.findMitigation(death, fight),
          available: this.findAvailable(death, fight),
        };
      });
  }

  /**
   * Survival abilities the player demonstrably had off cooldown when they died:
   * something they used at some point during this encounter (so we know they
   * have it) whose last cast before the death was longer ago than its cooldown.
   * Only spells with a known cooldown are considered.
   */
  private findAvailable(death: DeathEvent, fight: ReportFight): DeathRow['available'] {
    const report = this.store.report();
    const events = this.store.events();
    if (!report) {
      return [];
    }

    // Everything this player pressed across the included pulls tells us their kit.
    const known = new Set<number>();
    for (const pull of this.store.includedPulls()) {
      for (const cast of events.get(pull.id)?.friendlyCasts ?? []) {
        if (cast.sourceID === death.targetID && ABILITY_COOLDOWNS[cast.abilityGameID]) {
          known.add(cast.abilityGameID);
        }
      }
    }
    if (known.size === 0) {
      return [];
    }

    // Last use of each before the death, within this pull.
    const lastUse = new Map<number, number>();
    for (const cast of events.get(fight.id)?.friendlyCasts ?? []) {
      if (cast.sourceID === death.targetID && cast.timestamp <= death.timestamp) {
        lastUse.set(cast.abilityGameID, cast.timestamp);
      }
    }

    const available: DeathRow['available'] = [];
    for (const id of known) {
      const last = lastUse.get(id);
      const readyAt = last === undefined ? fight.startTime : last + ABILITY_COOLDOWNS[id] * 1000;
      if (readyAt <= death.timestamp) {
        const ability = report.abilities.get(id);
        available.push({
          id,
          name: ability?.name ?? `#${id}`,
          icon: abilityIconUrl(ability?.icon),
        });
      }
    }
    return available.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Last survival attempt by the dying player shortly before their death. */
  private findMitigation(death: DeathEvent, fight: ReportFight): DeathRow['mitigation'] {
    const report = this.store.report();
    const events = this.store.events().get(fight.id);
    if (!report || !events) {
      return null;
    }
    let mitigation: DeathRow['mitigation'] = null;
    for (const cast of events.friendlyCasts) {
      if (cast.sourceID !== death.targetID) {
        continue;
      }
      if (cast.timestamp > death.timestamp) {
        break;
      }
      if (death.timestamp - cast.timestamp > MITIGATION_WINDOW_MS) {
        continue;
      }
      const ability = report.abilities.get(cast.abilityGameID);
      const category = classifyAbility(cast.abilityGameID, ability?.name ?? null);
      if (category && MITIGATION_CATEGORIES.has(category)) {
        mitigation = {
          name: ability?.name ?? `#${cast.abilityGameID}`,
          icon: abilityIconUrl(ability?.icon),
          secondsBefore: Math.round((death.timestamp - cast.timestamp) / 1000),
        };
      }
    }
    return mitigation;
  }
}
