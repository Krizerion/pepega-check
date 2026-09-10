import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { ReportStore } from './core/state/report-store';
import { EncounterTabs } from './features/report/encounter-tabs';
import { ReportForm } from './features/report/report-form';
import { SettingsDialog } from './features/settings/settings-dialog';
import { FilterBar } from './features/timeline/filter-bar';
import { PullAnalysis } from './features/timeline/pull-analysis';
import { Sidebar } from './features/timeline/sidebar';
import { Timeline } from './features/timeline/timeline';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReportForm, EncounterTabs, Sidebar, FilterBar, PullAnalysis, Timeline, SettingsDialog],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(ReportStore);
  protected readonly settingsOpen = signal(false);
}
