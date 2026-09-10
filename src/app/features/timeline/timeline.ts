import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { classifyAbility, CATEGORY_META } from '../../core/data/ability-catalog';
import { abilityIconUrl, classColor } from '../../core/data/wow';
import { PlayerInfo, ReportFight, fightDuration, formatOffset } from '../../core/models/wcl';
import { ReportStore } from '../../core/state/report-store';

interface TimelineMarker {
  timeMs: number;
  kind: 'cast' | 'boss' | 'death';
  iconUrl: string | null;
  color: string;
  title: string;
  sub: string;
}

interface TimelineRow {
  key: string;
  kind: 'boss' | 'player' | 'pull';
  label: string;
  sublabel: string;
  labelColor: string;
  iconUrl: string | null;
  /** For pull rows: the pull's real duration (row is shaded up to here). */
  shadeMs: number | null;
  /** Navigation target when the label is clicked. */
  navId: number | null;
  markers: TimelineMarker[];
}

interface Tick {
  x: number;
  label: string;
}

interface Tooltip {
  x: number;
  y: number;
  title: string;
  sub: string;
}

const ROLE_SORT: Record<string, number> = { tank: 0, healer: 1, dps: 2 };
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
  templateUrl: './timeline.html',
  styleUrl: './timeline.scss',
})
export class Timeline {
  protected readonly store = inject(ReportStore);
  protected readonly tip = signal<Tooltip | null>(null);

  protected readonly loading = computed(() => {
    const pending = this.store.loadingFights();
    return this.store.fightsInView().some((f) => pending.has(f.id));
  });

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
    const events = pull ? this.store.events().get(pull.id) : null;
    if (!pull || !events) {
      return [];
    }
    const visible = this.store.selectedBossAbilityIds();
    const colorById = this.bossColorById();
    const pxPerMs = this.store.pxPerSecond() / 1000;
    return events.enemyCasts
      .filter(
        (c) =>
          c.type === 'cast' &&
          colorById.has(c.abilityGameID) &&
          (visible === null || visible.has(c.abilityGameID)),
      )
      .map((c) => ({
        x: (c.timestamp - pull.startTime) * pxPerMs,
        color: colorById.get(c.abilityGameID)!,
      }));
  });

  protected readonly rows = computed<TimelineRow[]>(() =>
    this.store.viewMode() === 'pull' ? this.buildPullRows() : this.buildPlayerRows(),
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
      const visible = this.store.selectedBossAbilityIds();
      this.store.bossAbilities().forEach((ability, index) => {
        if (visible !== null && !visible.has(ability.id)) {
          return;
        }
        const color = this.bossAbilityColor(index);
        rows.push({
          key: `boss:${ability.id}`,
          kind: 'boss',
          label: ability.name,
          sublabel: `×${ability.count}`,
          labelColor: BOSS_COLOR,
          iconUrl: abilityIconUrl(ability.icon),
          shadeMs: null,
          navId: null,
          markers: events.enemyCasts
            .filter((c) => c.type === 'cast' && c.abilityGameID === ability.id)
            .map((c) => ({
              timeMs: c.timestamp - pull.startTime,
              kind: 'boss' as const,
              iconUrl: abilityIconUrl(ability.icon),
              color,
              title: ability.name,
              sub: formatOffset(c.timestamp - pull.startTime),
            })),
        });
      });
    }

    for (const player of this.sortedPlayers()) {
      rows.push({
        key: `player:${player.id}`,
        kind: 'player',
        label: player.name,
        sublabel: player.spec ?? '',
        labelColor: classColor(player.className),
        iconUrl: null,
        shadeMs: null,
        navId: player.id,
        markers: this.playerMarkers(pull, player, `${player.name}`),
      });
    }

    return rows;
  }

  private buildPlayerRows(): TimelineRow[] {
    const player = this.store.selectedPlayer();
    const pulls = this.store.selectedEncounter()?.pulls ?? [];
    if (!player) {
      return [];
    }

    return pulls.map((pull, index) => {
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
        markers,
      };
    });
  }

  /** Classified casts + death markers for one player during one pull. */
  private playerMarkers(pull: ReportFight, player: PlayerInfo, context: string): TimelineMarker[] {
    const report = this.store.report();
    const events = this.store.events().get(pull.id);
    if (!report || !events) {
      return [];
    }

    const enabled = this.store.enabledCategories();
    const markers: TimelineMarker[] = [];

    for (const cast of events.friendlyCasts) {
      if (cast.sourceID !== player.id) {
        continue;
      }
      const ability = report.abilities.get(cast.abilityGameID);
      const category = classifyAbility(cast.abilityGameID, ability?.name ?? null);
      if (!category || !enabled.has(category)) {
        continue;
      }
      const timeMs = cast.timestamp - pull.startTime;
      markers.push({
        timeMs,
        kind: 'cast',
        iconUrl: abilityIconUrl(ability?.icon),
        color: CATEGORY_META.get(category)?.color ?? 'var(--text-2)',
        title: ability?.name ?? `Ability #${cast.abilityGameID}`,
        sub: `${formatOffset(timeMs)} · ${context}`,
      });
    }

    if (this.store.showDeaths()) {
      for (const death of events.deaths) {
        if (death.targetID !== player.id) {
          continue;
        }
        const killer = death.abilityGameID
          ? (report.abilities.get(death.abilityGameID)?.name ?? null)
          : null;
        const timeMs = death.timestamp - pull.startTime;
        markers.push({
          timeMs,
          kind: 'death',
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
    const events = this.store.events().get(pull.id);
    if (!report || !events) {
      return [];
    }
    const visible = this.store.selectedBossAbilityIds();
    // With no explicit selection, ticks for every ability would drown the row — show none.
    if (visible === null || visible.size === 0) {
      return [];
    }
    const colorById = this.bossColorById();
    return events.enemyCasts
      .filter((c) => c.type === 'cast' && visible.has(c.abilityGameID))
      .map((c) => {
        const ability = report.abilities.get(c.abilityGameID);
        const timeMs = c.timestamp - pull.startTime;
        return {
          timeMs,
          kind: 'boss' as const,
          iconUrl: abilityIconUrl(ability?.icon),
          color: colorById.get(c.abilityGameID) ?? BOSS_COLOR,
          title: ability?.name ?? `Ability #${c.abilityGameID}`,
          sub: formatOffset(timeMs),
        };
      });
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

  protected onLabelClick(row: TimelineRow): void {
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
    this.tip.set({
      x: Math.min(event.clientX + 14, window.innerWidth - 240),
      y: event.clientY + 16,
      title: marker.title,
      sub: marker.sub,
    });
  }

  protected hideTip(): void {
    this.tip.set(null);
  }

  protected onIconError(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }
}
