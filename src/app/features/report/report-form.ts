import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DEMO_REPORT_CODE } from '../../core/data/demo-report';
import { ReportStore } from '../../core/state/report-store';

/**
 * Loads a report, then gets out of the way.
 *
 * Once a report is open the input collapses into a chip naming it: the app bar
 * should say which log you are reading, not keep a wide empty text field around
 * for the one time you swap reports.
 */
@Component({
  selector: 'app-report-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (collapsed()) {
      <button class="loaded" (click)="editing.set(true)" title="Load a different report">
        <span class="zone">{{ zone() }}</span>
        <span class="title">{{ store.report()?.title }}</span>
        <span class="swap">change</span>
      </button>
    } @else {
      <form class="row" (submit)="load($event)">
        <input
          type="text"
          placeholder="Paste a Warcraft Logs report URL or code…"
          aria-label="Warcraft Logs report URL or code"
          [value]="input()"
          (input)="input.set(asInput($event).value)"
        />
        <button type="submit" class="primary" [disabled]="store.status() === 'loading'">
          Load
        </button>
        <button type="button" (click)="loadDemo()" [disabled]="store.status() === 'loading'">
          Demo
        </button>
        @if (store.report()) {
          <button type="button" class="cancel" (click)="editing.set(false)" aria-label="Cancel">
            ✕
          </button>
        }
      </form>
    }
  `,
  styles: `
    .row {
      display: flex;
      gap: 8px;
    }

    input {
      flex: 1 1 auto;
      min-width: 0;
    }

    .loaded {
      display: flex;
      align-items: baseline;
      gap: 8px;
      max-width: 100%;
      padding: 4px 11px;
      background: var(--bg-2);
      font-size: 13px;

      .zone {
        color: var(--text-2);
        white-space: nowrap;
      }

      .title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-0);
      }

      .swap {
        color: var(--accent);
        font-size: 11.5px;
        white-space: nowrap;
      }
    }

    .cancel {
      padding: 6px 9px;
    }

    @media (max-width: 720px) {
      .loaded .zone {
        display: none;
      }

      .row button:not(.primary):not(.cancel) {
        display: none;
      }
    }
  `,
})
export class ReportForm {
  protected readonly store = inject(ReportStore);
  protected readonly input = signal('');
  protected readonly editing = signal(false);

  protected readonly collapsed = computed(
    () => this.store.report() !== null && !this.editing() && this.store.status() === 'ready',
  );

  protected readonly zone = computed(() => this.store.report()?.zoneName ?? '');

  protected async load(event: Event): Promise<void> {
    event.preventDefault();
    await this.open(this.input());
  }

  protected async loadDemo(): Promise<void> {
    this.input.set(DEMO_REPORT_CODE);
    await this.open(DEMO_REPORT_CODE);
  }

  /** Collapses back to the chip only once a report actually loaded. */
  private async open(code: string): Promise<void> {
    await this.store.loadReport(code);
    if (this.store.status() === 'ready') {
      this.editing.set(false);
    }
  }

  protected asInput(event: Event): HTMLInputElement {
    return event.target as HTMLInputElement;
  }
}
