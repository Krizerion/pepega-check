import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CATEGORIES } from '../../core/data/ability-catalog';
import { abilityIconUrl } from '../../core/data/wow';
import { PlayerRole } from '../../core/models/wcl';
import { ReportStore } from '../../core/state/report-store';

@Component({
  selector: 'app-filter-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar">
      <div class="group">
        <span class="group-label">Roles:</span>
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

      <div class="group abilities">
        <button
          class="chip"
          [class.on]="allCategoriesOn()"
          [style.--chip-color]="'#7c5cff'"
          (click)="store.toggleAllCategories()"
          title="Toggle every ability category on or off"
        >
          All
        </button>
        @for (cat of store.abilitiesByCategory(); track cat.meta.id) {
          @if (cat.abilities.length > 0) {
            <div
              class="cat"
              [style.--chip-color]="cat.meta.color"
              [class.off]="!store.enabledCategories().has(cat.meta.id)"
            >
              <button
                class="cat-label"
                (click)="store.toggleCategory(cat.meta.id)"
                [title]="'Toggle ' + cat.meta.label"
              >
                {{ cat.meta.label }}:
              </button>
              @for (ability of cat.abilities; track ability.id) {
                <button
                  class="icon-btn"
                  [class.hidden-ability]="store.disabledAbilityIds().has(ability.id)"
                  (click)="store.toggleAbilityDisabled(ability.id)"
                  [title]="ability.name + ' — ' + ability.count + ' casts (click to toggle)'"
                >
                  <img [src]="iconUrl(ability.icon)" (error)="onIconError($event)" alt="" />
                </button>
              }
            </div>
          }
        }
      </div>

      <div class="group boss-filter">
        <span class="group-label">Boss:</span>
        <button
          class="chip"
          [class.on]="store.showBossAbilities()"
          [style.--chip-color]="'#b17ae8'"
          (click)="store.showBossAbilities.set(!store.showBossAbilities())"
        >
          <span class="dot"></span>Abilities
        </button>
        <button
          class="chip caret"
          (click)="pickerOpen.set(!pickerOpen())"
          title="Choose boss abilities"
        >
          {{ selectionSummary() }} ▾
        </button>
        @if (store.viewMode() === 'pull') {
          <button
            class="chip"
            [class.on]="store.showCastLines()"
            [style.--chip-color]="'#b17ae8'"
            (click)="store.showCastLines.set(!store.showCastLines())"
            title="Extend boss casts as vertical lines through all raider rows"
          >
            <span class="dot"></span>Cast lines
          </button>
        }
        @if (pickerOpen()) {
          <div class="picker" (mouseleave)="pickerOpen.set(false)">
            <div class="picker-actions">
              <button (click)="store.selectAllBossAbilities(true)">Select all</button>
              <button (click)="store.selectAllBossAbilities(false)">Deselect all</button>
            </div>
            @for (ability of store.bossAbilities(); track ability.id) {
              <label class="pick-row">
                <input
                  type="checkbox"
                  [checked]="isVisible(ability.id)"
                  (change)="toggle(ability.id)"
                />
                <img [src]="iconUrl(ability.icon)" (error)="onIconError($event)" alt="" />
                <span class="pick-name">{{ ability.name }}</span>
                <span class="pick-count">×{{ ability.count }}</span>
              </label>
            } @empty {
              <p class="empty">No boss casts loaded yet.</p>
            }
          </div>
        }
      </div>

      <div class="group">
        <span class="group-label">Deaths:</span>
        <button
          class="chip"
          [class.on]="store.showDeaths()"
          [style.--chip-color]="'#e5484d'"
          (click)="store.showDeaths.set(!store.showDeaths())"
        >
          <span class="dot"></span>Show
        </button>
        @if (store.viewMode() === 'pull') {
          <button
            class="chip"
            [class.on]="store.showAnalysis()"
            [style.--chip-color]="'#7c5cff'"
            (click)="store.showAnalysis.set(!store.showAnalysis())"
            title="Death log and wipe summary for this pull"
          >
            📋 Analysis
          </button>
          <label class="ignore" title="Grey out everything after the Nth death">
            ignore after
            <select
              [value]="store.ignoreAfterDeaths() ?? ''"
              (change)="setIgnoreDeaths(asSelect($event).value)"
            >
              <option value="">off</option>
              @for (n of deathOptions; track n) {
                <option [value]="n">{{ n }}</option>
              }
            </select>
          </label>
        }
      </div>

      <span class="spacer"></span>

      <div class="group zoom">
        <span class="group-label">Zoom:</span>
        <button (click)="zoom(-1)" [disabled]="store.pxPerSecond() <= 1">−</button>
        <span>{{ store.pxPerSecond() }}x</span>
        <button (click)="zoom(1)" [disabled]="store.pxPerSecond() >= 12">+</button>
      </div>
    </div>
  `,
  styles: `
    .bar {
      display: flex;
      align-items: stretch;
      flex-wrap: wrap;
      gap: 8px;
      position: relative;
    }

    .group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 10px;
    }

    .group-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-2);
      margin-right: 4px;
      white-space: nowrap;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 12px;
      background: var(--bg-1);
      color: var(--text-2);

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--text-2);
        opacity: 0.5;
      }

      &.on {
        color: var(--text-0);
        border-color: var(--chip-color);
        background: color-mix(in srgb, var(--chip-color) 14%, transparent);

        .dot {
          background: var(--chip-color);
          opacity: 1;
        }
      }
    }

    .abilities {
      flex-wrap: wrap;
      row-gap: 6px;
      flex: 1 1 auto;
    }

    .cat {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 3px 7px;
      background: var(--bg-1);
      border: 1px solid color-mix(in srgb, var(--chip-color) 35%, var(--border));
      border-radius: 8px;

      &.off {
        border-color: var(--border);

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
      background: none;
      border: none;
      padding: 0 4px 0 0;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--chip-color);
      white-space: nowrap;
      cursor: pointer;
    }

    .icon-btn {
      padding: 0;
      width: 24px;
      height: 24px;
      border-radius: 5px;
      border: 1px solid color-mix(in srgb, var(--chip-color) 70%, transparent);
      background: var(--bg-3);
      overflow: hidden;
      flex: 0 0 auto;

      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      &:hover {
        border-color: var(--chip-color);
      }

      &.hidden-ability img {
        filter: grayscale(1);
        opacity: 0.25;
      }
    }

    .boss-filter {
      position: relative;
    }

    .caret {
      border-radius: 999px;
      font-size: 12px;
      padding: 4px 10px;
    }

    .picker {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 50;
      min-width: 280px;
      max-height: 320px;
      overflow-y: auto;
      background: var(--bg-1);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 8px;
    }

    .picker-actions {
      display: flex;
      gap: 6px;
      padding: 2px 6px 8px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 6px;

      button {
        flex: 1;
        padding: 3px 8px;
        font-size: 12px;
      }
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

      .pick-name {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .pick-count {
        color: var(--text-2);
        font-size: 11px;
      }
    }

    .empty {
      color: var(--text-2);
      font-size: 12px;
      margin: 4px 6px;
    }

    .spacer {
      flex: 1;
    }

    .ignore {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12.5px;
      color: var(--text-2);

      select {
        padding: 2px 6px;
        font-size: 12.5px;
      }
    }

    .zoom {
      display: inline-flex;
      align-items: center;
      gap: 6px;

      span {
        min-width: 28px;
        text-align: center;
        color: var(--text-1);
        font-variant-numeric: tabular-nums;
        font-size: 12.5px;
      }

      button {
        padding: 2px 10px;
      }
    }
  `,
})
export class FilterBar {
  protected readonly store = inject(ReportStore);
  protected readonly deathOptions = [1, 2, 3, 4, 5, 8, 10];
  protected readonly roles: { id: PlayerRole; label: string; icon: string; color: string }[] = [
    { id: 'tank', label: 'Tanks', icon: '🛡️', color: '#5e9bff' },
    { id: 'healer', label: 'Healers', icon: '💚', color: '#46a758' },
    { id: 'dps', label: 'DPS', icon: '⚔️', color: '#e5484d' },
  ];
  protected readonly pickerOpen = signal(false);
  protected readonly iconUrl = abilityIconUrl;

  protected readonly allCategoriesOn = computed(
    () => this.store.enabledCategories().size === CATEGORIES.length,
  );

  protected readonly selectionSummary = computed(() => {
    const selected = this.store.selectedBossAbilityIds();
    const total = this.store.bossAbilities().length;
    return selected === null ? `All (${total})` : `${selected.size}/${total}`;
  });

  protected isVisible(abilityId: number): boolean {
    const selected = this.store.selectedBossAbilityIds();
    return selected === null || selected.has(abilityId);
  }

  protected toggle(abilityId: number): void {
    this.store.toggleBossAbility(
      abilityId,
      this.store.bossAbilities().map((a) => a.id),
    );
  }

  protected zoom(direction: number): void {
    const next = Math.min(12, Math.max(1, this.store.pxPerSecond() + direction));
    this.store.pxPerSecond.set(next);
  }

  protected onIconError(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }

  protected asSelect(event: Event): HTMLSelectElement {
    return event.target as HTMLSelectElement;
  }

  protected setIgnoreDeaths(value: string): void {
    this.store.ignoreAfterDeaths.set(value === '' ? null : Number(value));
  }
}
