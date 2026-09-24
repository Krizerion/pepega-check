import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CATEGORIES } from '../../core/data/ability-catalog';
import { ReportFight, difficultyLabel, fightDuration, formatOffset } from '../../core/models/wcl';
import { ReportStore, groupKey } from '../../core/state/report-store';
import { ShellState } from './shell-state';

/**
 * The single bar that answers "what am I looking at, and how".
 *
 * It replaces the old encounter tab strip and the wall-of-chips filter bar: the
 * boss and pull are pickers rather than lists, every filter moved behind one
 * button with a count, and the view is an explicit switch instead of a side
 * effect of clicking a raider's name.
 *
 * The selects carry `[value]` *and* `[selected]`: bindings resolve parent-first,
 * so on the first render the select's value is assigned while its options do
 * not exist yet and the browser falls back to the first one. `[selected]` fixes
 * the initial paint, `[value]` keeps later changes (the ‹ › steppers) in sync.
 */
@Component({
  selector: 'app-context-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar">
      <button
        class="rail-btn"
        (click)="shell.toggleRail()"
        [attr.aria-expanded]="shell.railOpen()"
        aria-label="Pulls and raiders"
        title="Pulls and raiders"
      >
        ☰
      </button>

      <label class="picker boss">
        <span class="sr-only">Boss encounter</span>
        <select [value]="store.selectedEncounterKey() ?? ''" (change)="pickBoss($event)">
          @for (encounter of store.encounters(); track key(encounter)) {
            <option
              [value]="key(encounter)"
              [selected]="key(encounter) === store.selectedEncounterKey()"
            >
              {{ encounter.name }} · {{ difficulty(encounter.difficulty) }} ({{
                encounter.pulls.length
              }})
            </option>
          }
        </select>
      </label>

      @if (pulls().length > 0) {
        <div class="stepper" role="group" aria-label="Pull">
          <button (click)="step(-1)" [disabled]="pullIndex() <= 0" aria-label="Previous pull">
            ‹
          </button>
          <label class="picker pull">
            <span class="sr-only">Pull</span>
            <select [value]="store.selectedPullId() ?? ''" (change)="pickPull($event)">
              @for (pull of pulls(); track pull.id; let i = $index) {
                <option [value]="pull.id" [selected]="pull.id === store.selectedPullId()">
                  {{ pullLabel(pull, i) }}
                </option>
              }
            </select>
          </label>
          <button
            (click)="step(1)"
            [disabled]="pullIndex() >= pulls().length - 1"
            aria-label="Next pull"
          >
            ›
          </button>
        </div>
      }

      <div class="views" role="group" aria-label="View">
        <button
          [class.active]="view() === 'timeline'"
          (click)="showTimeline()"
          title="One row per raider for the selected pull"
        >
          <span class="vi">▤</span><span class="vt">Timeline</span>
        </button>
        <button
          [class.active]="view() === 'raider'"
          (click)="showRaider()"
          [disabled]="store.players().length === 0"
          title="One row per pull for a single raider"
        >
          <span class="vi">👤</span><span class="vt">Raider</span>
        </button>
        <button
          [class.active]="view() === 'analysis'"
          (click)="toggleAnalysis()"
          title="Deaths, damage and phase breakdown"
        >
          <span class="vi">📋</span><span class="vt">Analysis</span>
        </button>
      </div>

      <span class="spacer"></span>

      @if (view() !== 'analysis') {
        <div class="zoom" role="group" aria-label="Zoom">
          <button (click)="zoom(-1)" [disabled]="store.pxPerSecond() <= 1" aria-label="Zoom out">
            −
          </button>
          <span>{{ store.pxPerSecond() }}×</span>
          <button (click)="zoom(1)" [disabled]="store.pxPerSecond() >= 12" aria-label="Zoom in">
            +
          </button>
        </div>
      }

      <button
        class="filters"
        [class.active]="shell.filtersOpen()"
        [class.modified]="activeFilters() > 0"
        (click)="shell.filtersOpen.set(!shell.filtersOpen())"
        [attr.aria-expanded]="shell.filtersOpen()"
      >
        <span class="fi">⚙</span><span class="ft">Filters</span>
        @if (activeFilters(); as n) {
          <span class="badge" [title]="n + ' filters differ from the default'">{{ n }}</span>
        }
      </button>
    </div>
  `,
  styles: `
    .bar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: var(--bar-h);
      padding: 6px 14px;
      background: var(--bg-1);
      border-bottom: 1px solid var(--border);
    }

    .rail-btn {
      display: none;
      padding: 4px 10px;
    }

    select {
      max-width: 100%;
      padding: 4px 8px;
      font-size: 13px;
      background: var(--bg-2);
      cursor: pointer;
    }

    .picker {
      min-width: 0;

      &.boss select {
        font-weight: 600;
        max-width: 260px;
      }

      &.pull select {
        border-radius: 0;
        border-left: none;
        border-right: none;
        min-width: 150px;
      }
    }

    .stepper {
      display: flex;
      align-items: stretch;

      button {
        padding: 4px 9px;
        font-size: 14px;
        line-height: 1;
      }

      button:first-child {
        border-radius: var(--radius) 0 0 var(--radius);
      }

      button:last-child {
        border-radius: 0 var(--radius) var(--radius) 0;
      }
    }

    /* Segmented control: the app's three modes, always visible so you can see
       which one you are in rather than inferring it from the content. */
    .views {
      display: inline-flex;
      padding: 2px;
      gap: 2px;
      background: var(--bg-0);
      border: 1px solid var(--border);
      border-radius: 9px;

      button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: none;
        background: none;
        border-radius: 7px;
        padding: 4px 11px;
        font-size: 12.5px;
        color: var(--text-2);

        &:hover:not(:disabled) {
          background: var(--bg-2);
          color: var(--text-0);
        }

        &.active {
          background: var(--accent);
          color: #fff;
          font-weight: 600;
        }
      }
    }

    .vi {
      font-size: 12px;
    }

    .spacer {
      flex: 1 1 auto;
    }

    .zoom {
      display: inline-flex;
      align-items: center;
      gap: 6px;

      button {
        padding: 2px 9px;
      }

      span {
        min-width: 26px;
        text-align: center;
        font-size: 12.5px;
        color: var(--text-1);
        font-variant-numeric: tabular-nums;
      }
    }

    .filters {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 11px;
      font-size: 12.5px;
      white-space: nowrap;

      &.active {
        border-color: var(--accent);
        background: var(--accent-soft);
      }

      /* A filter hiding data is invisible once you scroll away from the
         controls, so the count is always on screen. */
      &.modified .badge {
        background: var(--accent);
        color: #fff;
      }
    }

    .badge {
      min-width: 17px;
      padding: 0 4px;
      border-radius: 9px;
      background: var(--bg-3);
      color: var(--text-1);
      font-size: 11px;
      font-weight: 700;
      text-align: center;
    }

    /* The rail goes off-canvas at this width, so its opener has to appear at
       exactly the same breakpoint or there is no way back to it. */
    @media (max-width: 1080px) {
      .rail-btn {
        display: inline-flex;
      }

      .vt {
        display: none;
      }

      .vi {
        font-size: 14px;
      }
    }

    @media (max-width: 720px) {
      .bar {
        flex-wrap: wrap;
        gap: 6px;
        padding: 6px 10px;
      }

      .picker.boss {
        flex: 1 1 auto;

        select {
          width: 100%;
          max-width: none;
        }
      }

      /* Two rows: what am I looking at, then how. */
      .rail-btn {
        order: 1;
      }

      .picker.boss {
        order: 2;
      }

      .filters {
        order: 3;
      }

      .stepper {
        order: 4;
        flex: 1 1 auto;
        /* Without this the select's intrinsic width pins the row and pushes
           the zoom control onto a line of its own. */
        min-width: 0;

        .picker.pull {
          flex: 1 1 auto;

          select {
            width: 100%;
            min-width: 0;
          }
        }
      }

      .views {
        order: 5;
      }

      .zoom {
        order: 6;
      }

      .spacer {
        display: none;
      }

      .ft {
        display: none;
      }

      .views button {
        padding: 4px 8px;
      }

      .zoom button {
        padding: 2px 7px;
      }

      .zoom span {
        min-width: 20px;
        font-size: 12px;
      }
    }
  `,
})
export class ContextBar {
  protected readonly store = inject(ReportStore);
  protected readonly shell = inject(ShellState);
  protected readonly key = groupKey;
  protected readonly difficulty = difficultyLabel;

  protected readonly pulls = computed(() => this.store.selectedEncounter()?.pulls ?? []);

  protected readonly pullIndex = computed(() =>
    this.pulls().findIndex((p) => p.id === this.store.selectedPullId()),
  );

  protected readonly view = computed<'timeline' | 'raider' | 'analysis'>(() => {
    if (this.store.showAnalysis()) {
      return 'analysis';
    }
    return this.store.viewMode() === 'player' ? 'raider' : 'timeline';
  });

  /**
   * How many filters are hiding something. Zero means "you are seeing
   * everything", which is the question the bar needs to answer at a glance.
   */
  protected readonly activeFilters = computed(() => {
    let count = 0;
    if (this.store.enabledRoles().size < 3) {
      count++;
    }
    if (this.store.enabledCategories().size < CATEGORIES.length) {
      count++;
    }
    if (this.store.disabledAbilityIds().size > 0) {
      count++;
    }
    if (this.store.selectedBossAbilityIds() !== null) {
      count++;
    }
    if (!this.store.showBossAbilities()) {
      count++;
    }
    if (!this.store.showDeaths()) {
      count++;
    }
    if (this.store.ignoreAfterDeaths() !== null) {
      count++;
    }
    if (this.store.excludedPullIds().size > 0) {
      count++;
    }
    return count;
  });

  protected pullLabel(pull: ReportFight, index: number): string {
    const outcome = pull.kill
      ? 'Kill'
      : `${Math.round(pull.fightPercentage ?? 0)}%` +
        (pull.lastPhase !== null ? ` P${pull.lastPhase}` : '');
    return `Pull ${index + 1} · ${formatOffset(fightDuration(pull))} · ${outcome}`;
  }

  protected pickBoss(event: Event): void {
    void this.store.selectEncounter((event.target as HTMLSelectElement).value);
  }

  protected pickPull(event: Event): void {
    void this.store.selectPull(Number((event.target as HTMLSelectElement).value));
  }

  protected step(direction: number): void {
    const next = this.pulls()[this.pullIndex() + direction];
    if (next) {
      void this.store.selectPull(next.id);
    }
  }

  protected showTimeline(): void {
    this.store.showAnalysis.set(false);
    this.store.showPullView();
  }

  /** Raider view needs a raider; fall back to the first one in the roster. */
  protected showRaider(): void {
    this.store.showAnalysis.set(false);
    if (this.store.selectedPlayerId() === null) {
      const first = this.store.players()[0];
      if (first) {
        void this.store.selectPlayer(first.id);
      }
    }
  }

  protected toggleAnalysis(): void {
    this.store.showAnalysis.set(!this.store.showAnalysis());
  }

  protected zoom(direction: number): void {
    this.store.pxPerSecond.set(Math.min(12, Math.max(1, this.store.pxPerSecond() + direction)));
  }
}
