import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { difficultyLabel } from '../../core/models/wcl';
import { ReportStore, groupKey } from '../../core/state/report-store';

@Component({
  selector: 'app-encounter-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="tabs">
      @for (encounter of store.encounters(); track key(encounter)) {
        <button
          class="tab"
          [class.active]="key(encounter) === store.selectedEncounterKey()"
          (click)="select(encounter)"
        >
          <span class="name">{{ encounter.name }}</span>
          <span class="meta">
            {{ difficulty(encounter.difficulty) }} · {{ encounter.pulls.length }}
            {{ encounter.pulls.length === 1 ? 'pull' : 'pulls' }}
          </span>
        </button>
      }
      @if (store.report(); as report) {
        <span class="report-title" [title]="report.title">
          {{ report.zoneName ?? '' }} — {{ report.title }}
        </span>
      }
    </nav>
  `,
  styles: `
    .tabs {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px 0;
      overflow-x: auto;
    }

    .tab {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      padding: 6px 14px;
      white-space: nowrap;

      &.active {
        background: var(--accent-soft);
        border-color: var(--accent);
      }

      .name {
        font-weight: 600;
      }

      .meta {
        font-size: 11px;
        color: var(--text-2);
      }
    }

    .report-title {
      margin-left: auto;
      color: var(--text-2);
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 320px;
    }
  `,
})
export class EncounterTabs {
  protected readonly store = inject(ReportStore);
  protected readonly key = groupKey;
  protected readonly difficulty = difficultyLabel;

  protected select(encounter: Parameters<typeof groupKey>[0]): void {
    void this.store.selectEncounter(groupKey(encounter));
  }
}
