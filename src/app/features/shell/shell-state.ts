import { Injectable, signal } from '@angular/core';

/**
 * Chrome state that several shell pieces need to agree on.
 *
 * It lives here rather than in ReportStore because none of it describes the
 * report or survives a reload; it is purely what the window looks like right
 * now.
 */
@Injectable({ providedIn: 'root' })
export class ShellState {
  /** Phone: the rail is a slide-over. Desktop: the rail can be hidden for room. */
  readonly railOpen = signal(false);
  readonly settingsOpen = signal(false);

  toggleRail(): void {
    this.railOpen.set(!this.railOpen());
  }
}
