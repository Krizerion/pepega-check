import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CATEGORIES } from '../../core/data/ability-catalog';
import { abilityIconUrl } from '../../core/data/wow';
import { PlayerRole } from '../../core/models/wcl';
import { CategoryAbilities, ReportStore } from '../../core/state/report-store';
import { WowheadLink } from '../../core/wowhead/wowhead-tooltip';
import { ShellState } from './shell-state';

/**
 * Every filter in one overlay: a popover on desktop, a bottom sheet on a phone.
 *
 * These controls used to sit permanently above the timeline — 56 buttons and 38
 * spell icons that pushed the data off the bottom of the screen. They are all
 * still here, one press away, with a count on the trigger so an active filter
 * is never invisible.
 */
@Component({
  selector: 'app-filter-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WowheadLink],
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <button class="backdrop" (click)="close()" aria-label="Close filters" tabindex="-1"></button>

    <div class="sheet" role="dialog" aria-label="Filters">
      <header>
        <h2>Filters</h2>
        <button class="reset" (click)="resetAll()" title="Show everything again">Reset all</button>
        <button class="x" (click)="close()" aria-label="Close filters">✕</button>
      </header>

      <div class="body">
        <section>
          <h3>Roles</h3>
          <div class="chips">
            @for (role of roles; track role.id) {
              <button
                class="chip"
                [class.on]="store.enabledRoles().has(role.id)"
                [style.--chip-color]="role.color"
                (click)="store.toggleRole(role.id)"
              >
                {{ role.icon }} {{ role.label }}
              </button>
            }
          </div>
        </section>

        <section>
          <h3>
            Raider abilities
            <button class="link" (click)="store.toggleAllCategories()">
              {{ allCategoriesOn() ? 'none' : 'all' }}
            </button>
          </h3>
          @for (cat of store.abilitiesByCategory(); track cat.meta.id) {
            @if (cat.abilities.length > 0) {
              <div
                class="cat"
                [style.--chip-color]="cat.meta.color"
                [class.off]="!store.enabledCategories().has(cat.meta.id)"
              >
                <button class="cat-label" (click)="store.toggleCategory(cat.meta.id)">
                  <span class="dot"></span>{{ cat.meta.label }}
                </button>
                <div class="icons">
                  @for (ability of cat.abilities; track ability.id) {
                    <button
                      class="icon-btn"
                      [class.hidden-ability]="store.disabledAbilityIds().has(ability.id)"
                      (click)="toggleAbility(cat, ability.id)"
                      [title]="ability.name + ' — ' + ability.count + ' casts'"
                    >
                      <img [src]="iconUrl(ability.icon)" (error)="onIconError($event)" alt="" />
                    </button>
                  }
                </div>
              </div>
            }
          } @empty {
            <p class="empty">No raider casts loaded yet.</p>
          }
        </section>

        <section>
          <h3>
            Boss abilities
            <button class="link" (click)="store.selectAllBossAbilities(allBossOn())">
              {{ allBossOn() ? 'all' : 'none' }}
            </button>
          </h3>
          <div class="chips">
            <button
              class="chip"
              [class.on]="store.showBossAbilities()"
              [style.--chip-color]="'#b17ae8'"
              (click)="store.showBossAbilities.set(!store.showBossAbilities())"
            >
              <span class="dot"></span>Show lane
            </button>
            @if (store.viewMode() === 'pull') {
              <button
                class="chip"
                [class.on]="store.showCastLines()"
                [style.--chip-color]="'#b17ae8'"
                (click)="store.showCastLines.set(!store.showCastLines())"
                title="Extend boss casts as vertical lines through every raider row"
              >
                <span class="dot"></span>Cast lines
              </button>
            }
          </div>
          <div class="picks">
            @for (ability of store.bossAbilities(); track ability.id) {
              <label class="pick-row">
                <input
                  type="checkbox"
                  [checked]="isVisible(ability.id)"
                  (change)="toggleBoss(ability.id)"
                />
                <img [src]="iconUrl(ability.icon)" (error)="onIconError($event)" alt="" />
                <span class="pick-name">{{ ability.name }}</span>
                <span class="pick-count">×{{ ability.count }}</span>
                <a
                  appWowhead
                  class="pick-link"
                  [href]="'https://www.wowhead.com/spell=' + ability.id"
                  target="_blank"
                  rel="noreferrer"
                  (click)="$event.stopPropagation()"
                  aria-label="Open on Wowhead"
                  >↗</a
                >
              </label>
            } @empty {
              <p class="empty">No boss casts loaded yet.</p>
            }
          </div>
        </section>

        <section>
          <h3>Deaths</h3>
          <div class="chips">
            <button
              class="chip"
              [class.on]="store.showDeaths()"
              [style.--chip-color]="'#e5484d'"
              (click)="store.showDeaths.set(!store.showDeaths())"
            >
              <span class="dot"></span>Show deaths
            </button>
          </div>
          <label class="ignore">
            Ignore everything after the
            <select
              [value]="store.ignoreAfterDeaths() ?? ''"
              (change)="setIgnoreDeaths(asSelect($event).value)"
            >
              <option value="">—</option>
              @for (n of deathOptions; track n) {
                <option [value]="n">{{ n }}</option>
              }
            </select>
            th death
          </label>
        </section>
      </div>
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 90;
    }

    /* A button for keyboard users, but it must stay a sheet of glass: the
       global button:hover swaps the background for an opaque colour, which
       would black out the app the moment the pointer crossed it. */
    .backdrop {
      position: absolute;
      inset: 0;
      padding: 0;
      border: none;
      border-radius: 0;
      background: rgba(0, 0, 0, 0.45);
      cursor: default;

      &:hover:not(:disabled) {
        background: rgba(0, 0, 0, 0.45);
        border-color: transparent;
      }
    }

    .sheet {
      position: absolute;
      top: calc(var(--bar-h) + 52px);
      right: 14px;
      width: min(420px, calc(100vw - 28px));
      max-height: calc(100vh - var(--bar-h) - 72px);
      display: flex;
      flex-direction: column;
      background: var(--bg-1);
      border: 1px solid var(--border-strong);
      border-radius: 12px;
      box-shadow: var(--shadow);
      animation: pop 0.14s ease-out;
    }

    @keyframes pop {
      from {
        transform: translateY(-6px);
        opacity: 0;
      }
    }

    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);

      h2 {
        flex: 1;
        margin: 0;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-2);
      }
    }

    .reset {
      padding: 3px 9px;
      font-size: 12px;
    }

    .x {
      background: none;
      border: none;
      padding: 2px 6px;
      color: var(--text-2);
    }

    .body {
      overflow-y: auto;
      padding: 4px 12px 14px;
    }

    section + section {
      margin-top: 6px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }

    h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0 8px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text-2);
    }

    .link {
      background: none;
      border: none;
      padding: 0;
      font-size: 11px;
      text-transform: none;
      letter-spacing: 0;
      text-decoration: underline;
      color: var(--accent);
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      background: var(--bg-2);
      color: var(--text-2);

      &.on {
        color: var(--text-0);
        border-color: var(--chip-color);
        background: color-mix(in srgb, var(--chip-color) 16%, transparent);

        .dot {
          background: var(--chip-color);
          opacity: 1;
        }
      }
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-2);
      opacity: 0.5;
    }

    .cat {
      margin-bottom: 8px;

      &.off {
        .cat-label {
          color: var(--text-2);
        }

        .icon-btn img {
          filter: grayscale(1);
          opacity: 0.3;
        }
      }
    }

    .cat-label {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      background: none;
      border: none;
      padding: 2px 0 5px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--chip-color);
      text-align: left;

      .dot {
        background: var(--chip-color);
        opacity: 1;
      }
    }

    .cat.off .cat-label .dot {
      background: var(--text-2);
      opacity: 0.5;
    }

    .icons {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .icon-btn {
      padding: 0;
      width: 26px;
      height: 26px;
      border-radius: 5px;
      border: 1px solid color-mix(in srgb, var(--chip-color) 60%, transparent);
      background: var(--bg-3);
      overflow: hidden;

      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      &.hidden-ability img {
        filter: grayscale(1);
        opacity: 0.25;
      }
    }

    .picks {
      margin-top: 8px;
      max-height: 210px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px;
    }

    .pick-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: 6px;
      cursor: pointer;

      &:hover {
        background: var(--bg-2);
      }

      img {
        width: 18px;
        height: 18px;
        border-radius: 3px;
      }

      input {
        accent-color: var(--accent);
      }
    }

    .pick-name {
      flex: 1;
      font-size: 12.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pick-count {
      color: var(--text-2);
      font-size: 11px;
    }

    .pick-link {
      color: var(--text-2);
      text-decoration: none;
      padding: 0 2px;

      &:hover {
        color: var(--accent);
      }
    }

    .ignore {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      font-size: 12.5px;
      color: var(--text-1);

      select {
        padding: 2px 6px;
      }
    }

    .empty {
      margin: 2px 0;
      font-size: 12px;
      color: var(--text-2);
    }

    /* Phone: a bottom sheet you can reach with a thumb, not a popover pinned
       to a trigger that may be off screen. */
    @media (max-width: 720px) {
      .sheet {
        top: auto;
        right: 0;
        left: 0;
        bottom: 0;
        width: 100%;
        max-height: 82vh;
        border-radius: 14px 14px 0 0;
        animation: slide-up 0.18s ease-out;
      }

      @keyframes slide-up {
        from {
          transform: translateY(24px);
          opacity: 0;
        }
      }

      .icon-btn {
        width: 30px;
        height: 30px;
      }

      .pick-row {
        padding: 7px 6px;
      }
    }
  `,
})
export class FilterPanel {
  protected readonly store = inject(ReportStore);
  private readonly shell = inject(ShellState);
  protected readonly iconUrl = abilityIconUrl;
  protected readonly deathOptions = [1, 2, 3, 4, 5, 8, 10];
  protected readonly roles: { id: PlayerRole; label: string; icon: string; color: string }[] = [
    { id: 'tank', label: 'Tanks', icon: '🛡️', color: '#5e9bff' },
    { id: 'healer', label: 'Healers', icon: '💚', color: '#46a758' },
    { id: 'dps', label: 'DPS', icon: '⚔️', color: '#e5484d' },
  ];

  protected readonly allCategoriesOn = computed(
    () => this.store.enabledCategories().size === CATEGORIES.length,
  );

  /** True when some boss abilities are hidden, so the link offers "all". */
  protected readonly allBossOn = computed(() => this.store.selectedBossAbilityIds() !== null);

  protected isVisible(abilityId: number): boolean {
    const selected = this.store.selectedBossAbilityIds();
    return selected === null || selected.has(abilityId);
  }

  protected toggleAbility(cat: CategoryAbilities, abilityId: number): void {
    this.store.toggleAbilityVisibility(
      cat.meta.id,
      abilityId,
      cat.abilities.map((a) => a.id),
    );
  }

  protected toggleBoss(abilityId: number): void {
    this.store.toggleBossAbility(
      abilityId,
      this.store.bossAbilities().map((a) => a.id),
    );
  }

  protected resetAll(): void {
    this.store.enabledRoles.set(new Set(['tank', 'healer', 'dps']));
    this.store.enabledCategories.set(new Set(CATEGORIES.map((c) => c.id)));
    this.store.disabledAbilityIds.set(new Set());
    this.store.selectedBossAbilityIds.set(null);
    this.store.showBossAbilities.set(true);
    this.store.showDeaths.set(true);
    this.store.ignoreAfterDeaths.set(null);
    this.store.excludedPullIds.set(new Set());
  }

  protected setIgnoreDeaths(value: string): void {
    this.store.ignoreAfterDeaths.set(value === '' ? null : Number(value));
  }

  protected onIconError(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }

  protected asSelect(event: Event): HTMLSelectElement {
    return event.target as HTMLSelectElement;
  }

  protected close(): void {
    this.shell.filtersOpen.set(false);
  }
}
