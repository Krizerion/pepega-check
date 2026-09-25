import { ChangeDetectionStrategy, Component, effect, inject, untracked } from '@angular/core';

import { NotifyService } from './core/notify/notify.service';
import { ReportStore } from './core/state/report-store';
import { UrlStateService } from './core/state/url-state.service';
import { ReportForm } from './features/report/report-form';
import { SettingsDialog } from './features/settings/settings-dialog';
import { ContextBar } from './features/shell/context-bar';
import { FilterStrip } from './features/shell/filter-strip';
import { ShellState } from './features/shell/shell-state';
import { PullAnalysis } from './features/timeline/pull-analysis';
import { Sidebar } from './features/timeline/sidebar';
import { Timeline } from './features/timeline/timeline';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReportForm, ContextBar, FilterStrip, Sidebar, PullAnalysis, Timeline, SettingsDialog],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(ReportStore);
  protected readonly shell = inject(ShellState);
  private readonly notify = inject(NotifyService);

  constructor() {
    // Restore whatever the URL points at, then keep it in sync.
    inject(UrlStateService).start();

    /*
     * Surface store errors as toasts.
     *
     * The signal is cleared straight afterwards so it behaves as a one-shot
     * announcement: it used to drive a banner that sat there until dismissed,
     * which meant a transient failure on one pull kept accusing the app of
     * being broken long after it had recovered. A fatal load failure is a
     * different thing and still gets the full-screen treatment below.
     */
    effect(() => {
      const message = this.store.error();
      if (!message) {
        return;
      }
      untracked(() => {
        if (this.store.status() !== 'error') {
          this.notify.error(message);
          this.store.error.set(null);
        }
      });
    });
  }
}
