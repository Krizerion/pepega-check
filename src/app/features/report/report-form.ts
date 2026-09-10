import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { DEMO_REPORT_CODE } from '../../core/data/demo-report';
import { ReportStore } from '../../core/state/report-store';

@Component({
  selector: 'app-report-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="row" (submit)="load($event)">
      <input
        type="text"
        placeholder="Paste a Warcraft Logs report URL or code…"
        [value]="input()"
        (input)="input.set(asInput($event).value)"
      />
      <button type="submit" class="primary" [disabled]="store.status() === 'loading'">Load</button>
      <button type="button" (click)="loadDemo()" [disabled]="store.status() === 'loading'">
        Demo
      </button>
    </form>
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
  `,
})
export class ReportForm {
  protected readonly store = inject(ReportStore);
  protected readonly input = signal('');

  protected asInput(event: Event): HTMLInputElement {
    return event.target as HTMLInputElement;
  }

  protected load(event: Event): void {
    event.preventDefault();
    void this.store.loadReport(this.input());
  }

  protected loadDemo(): void {
    this.input.set(DEMO_REPORT_CODE);
    void this.store.loadReport(DEMO_REPORT_CODE);
  }
}
