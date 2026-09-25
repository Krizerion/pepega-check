import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';

import { AbilityCategory, classifyAbility, CATEGORY_META } from '../../core/data/ability-catalog';
import { abilityIconUrl, classColor } from '../../core/data/wow';
import {
  CastEvent,
  DeathEvent,
  PlayerInfo,
  ReportFight,
  fightDuration,
  formatOffset,
  killingAbilityId,
} from '../../core/models/wcl';
import { ReportStore } from '../../core/state/report-store';
import { WowheadLink } from '../../core/wowhead/wowhead-tooltip';

interface TimelineMarker {
  timeMs: number;
  kind: 'cast' | 'boss' | 'death';
  /** The spell, so a clicked marker can offer its Wowhead page. */
  abilityId: number | null;
  iconUrl: string | null;
  color: string;
  title: string;
  sub: string;
  /** Stagger level within a merged lane (undefined = vertically centered). */
  lane?: number;
}

interface TimelineRow {
  key: string;
  kind: 'boss' | 'boss-merged' | 'section' | 'player' | 'pull';
  label: string;
  sublabel: string;
  labelColor: string;
  iconUrl: string | null;
  /** For pull rows: the pull's real duration (row is shaded up to here). */
  shadeMs: number | null;
  /** Navigation target when the label is clicked. */
  navId: number | null;
  /** Boss rows link their label to Wowhead; nothing else does. */
  wowheadUrl: string | null;
  markers: TimelineMarker[];
}

interface Tick {
  x: number;
  label: string;
}

/** Per-fight lookups, so row building never rescans the whole log. */
interface FightIndex {
  castsByPlayer: Map<number, CastEvent[]>;
  deathsByPlayer: Map<number, DeathEvent[]>;
  /** Classification is per ability, not per cast — the regex fallback is slow. */
  categoryByAbility: Map<number, AbilityCategory | null>;
  enemyCastsByAbility: Map<number, CastEvent[]>;
}

interface Tooltip {
  x: number;
  y: number;
  title: string;
  sub: string;
  /** Wowhead page for the spell, when the marker has one. */
  url: string | null;
  /**
   * Pinned tooltips survive the pointer leaving the marker. The Wowhead widget
   * only renders on hover of a real link, so clicking a marker parks the card
   * with that link inside it rather than trying to drive the widget directly.
   */
  pinned: boolean;
}

const ROLE_SORT: Record<string, number> = { tank: 0, healer: 1, dps: 2 };

const ROLE_META: Record<string, { label: string; icon: string; color: string }> = {
  tank: { label: 'Tanks', icon: '🛡️', color: '#5e9bff' },
  healer: { label: 'Healers', icon: '💚', color: '#46a758' },
  dps: { label: 'DPS', icon: '⚔️', color: '#e5484d' },
};
/** Keep in sync with `--label-w` in styles.scss. */
const LABEL_W = 230;
const NARROW_LABEL_W = 116;
const NARROW_QUERY = '(max-width: 720px)';

const BOSS_COLOR = '#b17ae8';
const DEATH_COLOR = '#e5484d';

/** Distinct colors assigned to boss abilities (by frequency rank) for markers and cast lines. */
const BOSS_PALETTE = [
  '#b17ae8',
  '#e5484d',
  '#3fc7eb',
  '#f5a524',
  '#46a758',
  '#f48cba',
  '#ffd60a',
  '#8788ee',
];

@Component({
  selector: 'app-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WowheadLink],
  host: {
    '(document:click)': 'unpinTip()',
    '(document:keydown.escape)': 'unpinTip()',
  },
  templateUrl: './timeline.html',
  styleUrl: './timeline.scss',
})
export class Timeline {
  protected readonly store = inject(ReportStore);
  protected readonly tip = signal<Tooltip | null>(null);

  /**
   * Width of the row-label column, mirroring `--label-w`. Overlay positions
   * (cast lines, phase marks) are absolute pixels, so the value has to exist in
   * TypeScript as well as CSS — a narrow phone column that only CSS knew about
   * would leave every line drawn in the wrong place.
   */
  protected readonly labelWidth = signal(LABEL_W);

  protected readonly loading = computed(() => {
    const pending = this.store.loadingFights();
    return this.store.fightsInView().some((f) => pending.has(f.id));
  });

  constructor() {
    // Resolved here rather than at module scope: a test or server render has no
    // window, and a module-level query would throw before the class exists.
    const media = globalThis.matchMedia?.(NARROW_QUERY);
    if (!media) {
      return;
    }
    this.labelWidth.set(media.matches ? NARROW_LABEL_W : LABEL_W);
    const onChange = (event: MediaQueryListEvent) =>
      this.labelWidth.set(event.matches ? NARROW_LABEL_W : LABEL_W);
    media.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
  }

  protected readonly durationMs = computed(() => {
    const fights = this.store.fightsInView();
    return fights.reduce((max, f) => Math.max(max, fightDuration(f)), 0);
  });

  protected readonly trackWidth = computed(
    () => (this.durationMs() / 1000) * this.store.pxPerSecond(),
  );

  protected readonly ticks = computed<Tick[]>(() => {
    const pxPerSecond = this.store.pxPerSecond();
    const stepSec = pxPerSecond >= 3 ? 30 : 60;
    const ticks: Tick[] = [];
    for (let s = 0; s * 1000 <= this.durationMs(); s += stepSec) {
      ticks.push({ x: s * pxPerSecond, label: formatOffset(s * 1000) });
    }
    return ticks;
  });

  protected readonly gridSize = computed(() => `${30 * this.store.pxPerSecond()}px 100%`);

  protected readonly cornerLabel = computed(() => {
    if (this.store.viewMode() === 'player') {
      return `◀ ${this.store.selectedPlayer()?.name ?? ''} — all pulls`;
    }
    const pull = this.store.selectedPull();
    if (!pull) {
      return '';
    }
    const index =
      (this.store.selectedEncounter()?.pulls.findIndex((p) => p.id === pull.id) ?? 0) + 1;
    return `Pull ${index} — ${formatOffset(fightDuration(pull))}`;
  });

  protected readonly phaseMarks = computed<{ x: number; id: number }[]>(() => {
    if (this.store.viewMode() !== 'pull') {
      return [];
    }
    const pull = this.store.selectedPull();
    if (!pull?.phaseTransitions) {
      return [];
    }
    const pxPerMs = this.store.pxPerSecond() / 1000;
    return pull.phaseTransitions
      .filter((p) => p.startTime > pull.startTime)
      .map((p) => ({ x: (p.startTime - pull.startTime) * pxPerMs, id: p.id }));
  });

  /** Vertical lines through all rows at each visible boss cast (pull view, opt-in). */
  protected readonly castLines = computed<{ x: number; color: string }[]>(() => {
    if (
      this.store.viewMode() !== 'pull' ||
      !this.store.showCastLines() ||
      !this.store.showBossAbilities()
    ) {
      return [];
    }
    const pull = this.store.selectedPull();
    const index = pull ? this.fightIndex().get(pull.id) : null;
    if (!pull || !index) {
      return [];
    }
    const visible = this.store.selectedBossAbilityIds();
    const colorById = this.bossColorById();
    const pxPerMs = this.store.pxPerSecond() / 1000;
    const lines: { x: number; color: string }[] = [];
    for (const [abilityId, color] of colorById) {
      if (visible !== null && !visible.has(abilityId)) {
        continue;
      }
      for (const cast of index.enemyCastsByAbility.get(abilityId) ?? []) {
        lines.push({ x: (cast.timestamp - pull.startTime) * pxPerMs, color });
      }
    }
    return lines;
  });

  /** Fight-relative time of the Nth death in the selected pull ("ignore after X deaths"). */
  protected readonly cutoffMs = computed<number | null>(() => {
    const n = this.store.ignoreAfterDeaths();
    if (n === null || this.store.viewMode() !== 'pull') {
      return null;
    }
    const pull = this.store.selectedPull();
    const events = pull ? this.store.events().get(pull.id) : null;
    if (!pull || !events || events.deaths.length < n) {
      return null;
    }
    const sorted = [...events.deaths].sort((a, b) => a.timestamp - b.timestamp);
    return sorted[n - 1].timestamp - pull.startTime;
  });

  protected isDimmed(marker: TimelineMarker): boolean {
    const cutoff = this.cutoffMs();
    return cutoff !== null && marker.timeMs > cutoff;
  }

  protected readonly rows = computed<TimelineRow[]>(() =>
    this.store.viewMode() === 'pull' ? this.buildPullRows() : this.buildPlayerRows(),
  );

  /**
   * Casts grouped by who cast them, deaths by who died, boss casts by ability,
   * and each ability classified once.
   *
   * Row building used to walk every cast in the fight once per raider and
   * classify it there: twenty raiders over a long pull meant hundreds of
   * thousands of regex-backed classifications, repeated on every filter toggle.
   * This depends only on the report and its events, so toggling a category or
   * hiding a spell now re-reads the index instead of rebuilding it.
   */
  private readonly fightIndex = computed<ReadonlyMap<number, FightIndex>>(() => {
    const report = this.store.report();
    const eventsByFight = this.store.events();
    const index = new Map<number, FightIndex>();
    if (!report) {
      return index;
    }

    for (const fight of this.store.fightsInView()) {
      const events = eventsByFight.get(fight.id);
      if (!events) {
        continue;
      }

      const castsByPlayer = new Map<number, CastEvent[]>();
      const categoryByAbility = new Map<number, AbilityCategory | null>();
      for (const cast of events.friendlyCasts) {
        push(castsByPlayer, cast.sourceID, cast);
        if (!categoryByAbility.has(cast.abilityGameID)) {
          const ability = report.abilities.get(cast.abilityGameID);
          categoryByAbility.set(
            cast.abilityGameID,
            classifyAbility(cast.abilityGameID, ability?.name ?? null),
          );
        }
      }

      const deathsByPlayer = new Map<number, DeathEvent[]>();
      for (const death of events.deaths) {
        push(deathsByPlayer, death.targetID, death);
      }

      const enemyCastsByAbility = new Map<number, CastEvent[]>();
      for (const cast of events.enemyCasts) {
        if (cast.type === 'cast') {
          push(enemyCastsByAbility, cast.abilityGameID, cast);
        }
      }

      index.set(fight.id, {
        castsByPlayer,
        deathsByPlayer,
        categoryByAbility,
        enemyCastsByAbility,
      });
    }
    return index;
  });

  /** Actor names by id, so a death does not linear-search the roster. */
  private readonly actorNameById = computed(
    () => new Map((this.store.report()?.actors ?? []).map((a) => [a.id, a.name])),
  );

  // --- row building ---

  private buildPullRows(): TimelineRow[] {
    const pull = this.store.selectedPull();
    const events = pull ? this.store.events().get(pull.id) : null;
    if (!pull || !events) {
      return [];
    }

    const rows: TimelineRow[] = [];

    if (this.store.showBossAbilities()) {
      rows.push(...this.bossRows(pull));
    }

    const enabledRoles = this.store.enabledRoles();
    const collapsedRoles = this.store.collapsedRoles();
    const players = this.sortedPlayers().filter((p) => enabledRoles.has(p.role));

    for (const role of ['tank', 'healer', 'dps'] as const) {
      const group = players.filter((p) => p.role === role);
      if (group.length === 0) {
        continue;
      }
      const meta = ROLE_META[role];
      const collapsed = collapsedRoles.has(role);
      rows.push({
        key: `section:${role}`,
        kind: 'section',
        label: `${collapsed ? '▸' : '▾'} ${meta.icon} ${meta.label}`,
        sublabel: collapsed ? `${group.length} hidden` : `${group.length}`,
        labelColor: meta.color,
        iconUrl: null,
        shadeMs: null,
        navId: null,
        wowheadUrl: null,
        markers: [],
      });
      if (collapsed) {
        continue;
      }
      for (const player of group) {
        rows.push({
          key: `player:${player.id}`,
          kind: 'player',
          label: player.name,
          sublabel: player.spec ?? '',
          labelColor: classColor(player.className),
          iconUrl: null,
          shadeMs: null,
          navId: player.id,
          wowheadUrl: null,
          markers: this.playerMarkers(pull, player, `${player.name}`),
        });
      }
    }

    return rows;
  }

  /** Boss casts: one merged horizontal lane by default, per-ability rows when expanded. */
  private bossRows(pull: ReportFight, labelSuffix = ''): TimelineRow[] {
    const visible = this.store.selectedBossAbilityIds();
    const castsByAbility = this.fightIndex().get(pull.id)?.enemyCastsByAbility;
    const abilities = this.store
      .bossAbilities()
      .map((ability, index) => ({ ability, color: this.bossAbilityColor(index) }))
      .filter(({ ability }) => visible === null || visible.has(ability.id));

    const markersFor = (abilityId: number, icon: string | null, name: string, color: string) =>
      (castsByAbility?.get(abilityId) ?? []).map((c) => ({
        timeMs: c.timestamp - pull.startTime,
        kind: 'boss' as const,
        abilityId,
        iconUrl: abilityIconUrl(icon),
        color,
        title: name,
        sub: formatOffset(c.timestamp - pull.startTime),
      }));

    if (!this.store.bossLaneExpanded()) {
      const merged: TimelineMarker[] = abilities.flatMap(({ ability, color }, index) =>
        markersFor(ability.id, ability.icon, ability.name, color).map((m) => ({
          ...m,
          lane: index % 3,
        })),
      );
      merged.sort((a, b) => a.timeMs - b.timeMs);
      return [
        {
          key: 'boss-merged',
          kind: 'boss-merged',
          label: `▸ Boss abilities${labelSuffix}`,
          sublabel: `${merged.length} casts`,
          labelColor: BOSS_COLOR,
          iconUrl: null,
          shadeMs: null,
          navId: null,
          wowheadUrl: null,
          markers: merged,
        },
      ];
    }

    return [
      {
        key: 'boss-merged',
        kind: 'section',
        label: `▾ Boss abilities${labelSuffix}`,
        sublabel: 'collapse',
        labelColor: BOSS_COLOR,
        iconUrl: null,
        shadeMs: null,
        navId: null,
        wowheadUrl: null,
        markers: [],
      },
      ...abilities.map(({ ability, color }) => ({
        key: `boss:${ability.id}`,
        kind: 'boss' as const,
        label: ability.name,
        sublabel: `×${ability.count}`,
        labelColor: BOSS_COLOR,
        iconUrl: abilityIconUrl(ability.icon),
        shadeMs: null,
        navId: null,
        wowheadUrl: `https://www.wowhead.com/spell=${ability.id}`,
        markers: markersFor(ability.id, ability.icon, ability.name, color),
      })),
    ];
  }

  private buildPlayerRows(): TimelineRow[] {
    const player = this.store.selectedPlayer();
    const allPulls = this.store.selectedEncounter()?.pulls ?? [];
    const pulls = this.store.fightsInView();
    if (!player) {
      return [];
    }

    const rows: TimelineRow[] = [];

    // Reference boss lane: the longest included pull spans the whole time axis.
    if (this.store.showBossAbilities()) {
      const reference = pulls.reduce<ReportFight | null>(
        (best, p) => (!best || fightDuration(p) > fightDuration(best) ? p : best),
        null,
      );
      const events = reference ? this.store.events().get(reference.id) : null;
      if (reference && events) {
        rows.push(...this.bossRows(reference, ` · from pull ${allPulls.indexOf(reference) + 1}`));
      }
    }

    const pullRows = pulls.map((pull) => {
      const index = allPulls.indexOf(pull);
      const markers = this.playerMarkers(pull, player, `Pull ${index + 1}`);
      if (this.store.showBossAbilities()) {
        markers.push(...this.bossTickMarkers(pull));
        markers.sort((a, b) => a.timeMs - b.timeMs);
      }
      return {
        key: `pull:${pull.id}`,
        kind: 'pull' as const,
        label: `Pull ${index + 1}`,
        sublabel: pull.kill
          ? `${formatOffset(fightDuration(pull))} · Kill`
          : `${formatOffset(fightDuration(pull))} · ${Math.round(pull.fightPercentage ?? 0)}%` +
            (pull.lastPhase !== null ? ` P${pull.lastPhase}` : ''),
        labelColor: pull.kill ? 'var(--success)' : 'var(--text-0)',
        iconUrl: null,
        shadeMs: fightDuration(pull),
        navId: pull.id,
        wowheadUrl: null,
        markers,
      };
    });

    return [...rows, ...pullRows];
  }

  /** Classified casts + death markers for one player during one pull. */
  private playerMarkers(pull: ReportFight, player: PlayerInfo, context: string): TimelineMarker[] {
    const report = this.store.report();
    const index = this.fightIndex().get(pull.id);
    if (!report || !index) {
      return [];
    }

    const enabled = this.store.enabledCategories();
    const disabled = this.store.disabledAbilityIds();
    const markers: TimelineMarker[] = [];

    for (const cast of index.castsByPlayer.get(player.id) ?? []) {
      if (disabled.has(cast.abilityGameID)) {
        continue;
      }
      const category = index.categoryByAbility.get(cast.abilityGameID);
      if (!category || !enabled.has(category)) {
        continue;
      }
      const ability = report.abilities.get(cast.abilityGameID);
      const timeMs = cast.timestamp - pull.startTime;
      markers.push({
        timeMs,
        kind: 'cast',
        abilityId: cast.abilityGameID,
        iconUrl: abilityIconUrl(ability?.icon),
        color: CATEGORY_META.get(category)?.color ?? 'var(--text-2)',
        title: ability?.name ?? `Ability #${cast.abilityGameID}`,
        sub: `${formatOffset(timeMs)} · ${context}`,
      });
    }

    if (this.store.showDeaths()) {
      for (const death of index.deathsByPlayer.get(player.id) ?? []) {
        const abilityId = killingAbilityId(death);
        const killer =
          (abilityId !== null ? report.abilities.get(abilityId)?.name : null) ??
          (death.killerID != null ? (this.actorNameById().get(death.killerID) ?? null) : null);
        const timeMs = death.timestamp - pull.startTime;
        markers.push({
          timeMs,
          kind: 'death',
          abilityId,
          iconUrl: null,
          color: DEATH_COLOR,
          title: `${player.name} died`,
          sub: formatOffset(timeMs) + (killer ? ` · ${killer}` : ''),
        });
      }
    }

    return markers.sort((a, b) => a.timeMs - b.timeMs);
  }

  /** Small boss-cast ticks overlaid on pull rows in the player view. */
  private bossTickMarkers(pull: ReportFight): TimelineMarker[] {
    const report = this.store.report();
    const index = this.fightIndex().get(pull.id);
    if (!report || !index) {
      return [];
    }
    const visible = this.store.selectedBossAbilityIds();
    // With no explicit selection, ticks for every ability would drown the row — show none.
    if (visible === null || visible.size === 0) {
      return [];
    }
    const colorById = this.bossColorById();
    const markers: TimelineMarker[] = [];
    for (const abilityId of visible) {
      const ability = report.abilities.get(abilityId);
      for (const cast of index.enemyCastsByAbility.get(abilityId) ?? []) {
        const timeMs = cast.timestamp - pull.startTime;
        markers.push({
          timeMs,
          kind: 'boss',
          abilityId,
          iconUrl: abilityIconUrl(ability?.icon),
          color: colorById.get(abilityId) ?? BOSS_COLOR,
          title: ability?.name ?? `Ability #${abilityId}`,
          sub: formatOffset(timeMs),
        });
      }
    }
    return markers;
  }

  private bossAbilityColor(index: number): string {
    return BOSS_PALETTE[index % BOSS_PALETTE.length];
  }

  private bossColorById(): Map<number, string> {
    return new Map(this.store.bossAbilities().map((a, i) => [a.id, this.bossAbilityColor(i)]));
  }

  private sortedPlayers(): PlayerInfo[] {
    return [...this.store.players()].sort(
      (a, b) =>
        (ROLE_SORT[a.role] ?? 3) - (ROLE_SORT[b.role] ?? 3) ||
        a.className.localeCompare(b.className) ||
        a.name.localeCompare(b.name),
    );
  }

  // --- interaction ---

  protected x(timeMs: number): number {
    return (timeMs / 1000) * this.store.pxPerSecond();
  }

  protected isClickable(row: TimelineRow): boolean {
    return row.navId !== null || row.key === 'boss-merged' || row.key.startsWith('section:');
  }

  protected onLabelClick(row: TimelineRow): void {
    if (row.key === 'boss-merged') {
      this.store.bossLaneExpanded.set(!this.store.bossLaneExpanded());
      return;
    }
    if (row.key.startsWith('section:')) {
      const role = row.key.slice('section:'.length);
      if (role === 'tank' || role === 'healer' || role === 'dps') {
        this.store.toggleRoleCollapsed(role);
      }
      return;
    }
    if (row.navId === null) {
      return;
    }
    if (row.kind === 'player') {
      void this.store.selectPlayer(row.navId);
    } else if (row.kind === 'pull') {
      void this.store.selectPull(row.navId);
    }
  }

  protected backToPull(): void {
    if (this.store.viewMode() === 'player') {
      this.store.showPullView();
    }
  }

  protected showTip(event: MouseEvent, marker: TimelineMarker): void {
    if (this.tip()?.pinned) {
      return;
    }
    this.tip.set(this.tipFor(event, marker, false));
  }

  protected hideTip(): void {
    if (!this.tip()?.pinned) {
      this.tip.set(null);
    }
  }

  /**
   * Clicking a marker parks its card open so the Wowhead link inside can be
   * reached — the widget has no API to show a tooltip on demand, it only reacts
   * to hovering a link, so the card has to stay put long enough to move onto.
   */
  protected pinTip(event: MouseEvent, marker: TimelineMarker): void {
    event.stopPropagation();
    const current = this.tip();
    if (current?.pinned && current.title === marker.title && current.sub === marker.sub) {
      this.tip.set(null);
      return;
    }
    this.tip.set(this.tipFor(event, marker, true));
  }

  protected unpinTip(): void {
    if (this.tip()?.pinned) {
      this.tip.set(null);
    }
  }

  private tipFor(event: MouseEvent, marker: TimelineMarker, pinned: boolean): Tooltip {
    return {
      x: Math.min(event.clientX + 14, window.innerWidth - 240),
      y: event.clientY + 16,
      title: marker.title,
      sub: marker.sub,
      url:
        marker.abilityId !== null && marker.abilityId > 1
          ? `https://www.wowhead.com/spell=${marker.abilityId}`
          : null,
      pinned,
    };
  }

  protected onIconError(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }
}

/** Appends to the list stored at `key`, creating it on first use. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}
