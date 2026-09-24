import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

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

  constructor() {
    // Restore whatever the URL points at, then keep it in sync.
    inject(UrlStateService).start();
  }
}
