import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { classColor } from '../../core/data/wow';
import { PlayerInfo, PlayerRole, fightDuration, formatOffset } from '../../core/models/wcl';
import { ReportStore } from '../../core/state/report-store';
import { ShellState } from '../shell/shell-state';

const ROLE_ORDER: { role: PlayerRole; label: string; icon: string }[] = [
  { role: 'tank', label: 'Tanks', icon: '🛡️' },
  { role: 'healer', label: 'Healers', icon: '💚' },
  { role: 'dps', label: 'DPS', icon: '⚔️' },
];

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="sidebar">
      <header class="rail-head">
        <span class="rail-title">Pulls &amp; raiders</span>
        <button class="x" (click)="shell.railOpen.set(false)" aria-label="Hide panel">✕</button>
      </header>

      <section class="pulls">
        <h3>Pulls <span class="hint">— untick to exclude</span></h3>
        @for (pull of store.selectedEncounter()?.pulls ?? []; track pull.id; let i = $index) {
          <div class="pull-line" [class.excluded]="store.excludedPullIds().has(pull.id)">
            <input
              type="checkbox"
              [checked]="!store.excludedPullIds().has(pull.id)"
              (change)="store.togglePullExcluded(pull.id)"
              [attr.aria-label]="'Include pull ' + (i + 1)"
            />
            <button
              class="pull"
              [class.active]="store.viewMode() === 'pull' && pull.id === store.selectedPullId()"
              (click)="selectPull(pull.id)"
            >
              <span class="pull-num">{{ i + 1 }}</span>
              <span class="pull-time">{{ duration(pull) }}</span>
              @if (pull.kill) {
                <span class="badge kill">Kill</span>
              } @else {
                <span class="badge pct" [style.color]="pctColor(pull.fightPercentage)">
                  {{ pct(pull.fightPercentage) }}
                </span>
                @if (pull.lastPhase !== null) {
                  <span class="phase">P{{ pull.lastPhase }}</span>
                }
              }
            </button>
          </div>
        }
      </section>

      <section class="players">
        <h3>Raiders <span class="hint">— click to compare across pulls</span></h3>
        @for (group of roster(); track group.role) {
          @if (group.players.length > 0) {
            <div class="role-label">{{ group.icon }} {{ group.label }}</div>
            @for (player of group.players; track player.id) {
              <button
                class="player"
                [class.active]="player.id === store.selectedPlayerId()"
                (click)="selectPlayer(player.id)"
              >
                <span class="name" [style.color]="color(player)">{{ player.name }}</span>
                <span class="spec">{{ player.spec }}</span>
              </button>
            }
          }
        }
      </section>
    </aside>
  `,
  styles: `
    :host {
      flex: 0 0 var(--rail-w);
      min-height: 0;
    }

    .sidebar {
      height: 100%;
      width: var(--rail-w);
      overflow-y: auto;
      border-right: 1px solid var(--border);
      background: var(--bg-1);
      padding: 0 9px 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .rail-head {
      display: none;
      align-items: center;
      gap: 8px;
      position: sticky;
      top: 0;
      z-index: 2;
      margin: 0 -9px;
      padding: 9px 12px;
      background: var(--bg-1);
      border-bottom: 1px solid var(--border);
    }

    .rail-title {
      flex: 1;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-2);
    }

    .x {
      background: none;
      border: none;
      padding: 2px 6px;
      color: var(--text-2);
    }

    .pulls {
      padding-top: 12px;
    }

    /* Only an overlay needs a close button. */
    @media (max-width: 1080px) {
      .rail-head {
        display: flex;
      }

      .pulls {
        padding-top: 0;
      }
    }

    @media (max-width: 720px) {
      :host {
        flex-basis: min(300px, 86vw);
      }

      .sidebar {
        width: min(300px, 86vw);
      }

      .pull,
      .player {
        padding: 8px;
      }
    }

    h3 {
      margin: 0 0 8px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-2);

      .hint {
        text-transform: none;
        letter-spacing: normal;
        font-weight: 400;
        font-size: 11px;
      }
    }

    .pull-line {
      display: flex;
      align-items: center;
      gap: 4px;

      input {
        flex: 0 0 auto;
        accent-color: var(--accent);
        cursor: pointer;
      }

      &.excluded .pull {
        opacity: 0.4;
      }

      .pull {
        flex: 1 1 auto;
      }
    }

    .pull,
    .player {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      background: none;
      border: 1px solid transparent;
      padding: 5px 8px;
      border-radius: 6px;
      text-align: left;

      &:hover {
        background: var(--bg-2);
        border-color: transparent;
      }

      &.active {
        background: var(--accent-soft);
        border-color: var(--accent);
      }
    }

    .pull-num {
      color: var(--text-2);
      width: 20px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .pull-time {
      font-variant-numeric: tabular-nums;
      color: var(--text-1);
    }

    .badge {
      margin-left: auto;
      font-weight: 700;
      font-size: 12.5px;

      &.kill {
        color: var(--success);
      }
    }

    .phase {
      font-size: 11px;
      color: var(--text-2);
      width: 20px;
    }

    .role-label {
      font-size: 11px;
      color: var(--text-2);
      margin: 8px 0 3px;
    }

    .player .name {
      font-weight: 600;
    }

    .player .spec {
      margin-left: auto;
      font-size: 11px;
      color: var(--text-2);
    }
  `,
})
export class Sidebar {
  protected readonly store = inject(ReportStore);
  protected readonly shell = inject(ShellState);

  protected readonly roster = computed(() => {
    const players = this.store.players();
    return ROLE_ORDER.map((meta) => ({
      ...meta,
      players: players
        .filter((p) => p.role === meta.role)
        .sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name)),
    }));
  });

  protected duration(pull: Parameters<typeof fightDuration>[0]): string {
    return formatOffset(fightDuration(pull));
  }

  protected pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }

  /** Green when close to a kill, red when the pull died early. */
  protected pctColor(value: number | null): string {
    if (value === null) {
      return 'var(--text-2)';
    }
    if (value <= 20) {
      return '#b17ae8';
    }
    if (value <= 40) {
      return '#46a758';
    }
    if (value <= 65) {
      return '#f5a524';
    }
    return '#8b8b98';
  }

  protected color(player: PlayerInfo): string {
    return classColor(player.className);
  }

  /**
   * Picking from the rail is a navigation, so it returns to the timeline: with
   * the analysis panel open over the canvas, a silent selection change behind
   * it reads as a dead click.
   */
  protected selectPull(id: number): void {
    void this.store.selectPull(id);
    this.store.showPullView();
    this.closeOnPhone();
  }

  protected selectPlayer(id: number): void {
    void this.store.selectPlayer(id);
    this.closeOnPhone();
  }

  /** The rail is an overlay on narrow screens; leaving it open hides the result. */
  private closeOnPhone(): void {
    if (globalThis.matchMedia?.('(max-width: 1080px)').matches) {
      this.shell.railOpen.set(false);
    }
  }
}
