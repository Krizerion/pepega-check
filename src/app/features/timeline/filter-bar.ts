import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CATEGORIES } from '../../core/data/ability-catalog';
import { abilityIconUrl } from '../../core/data/wow';
import { ReportStore } from '../../core/state/report-store';

@Component({
  selector: 'app-filter-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar">
      @for (category of categories; track category.id) {
        <button
          class="chip"
          [class.on]="store.enabledCategories().has(category.id)"
          [style.--chip-color]="category.color"
          (click)="store.toggleCategory(category.id)"
        >
          <span class="dot"></span>{{ category.label }}
        </button>
      }

      <span class="divider"></span>

      <button
        class="chip"
        [class.on]="store.showDeaths()"
        [style.--chip-color]="'#e5484d'"
        (click)="store.showDeaths.set(!store.showDeaths())"
      >
        <span class="dot"></span>Deaths
      </button>

      <div class="boss-filter">
        <button
          class="chip"
          [class.on]="store.showBossAbilities()"
          [style.--chip-color]="'#b17ae8'"
          (click)="store.showBossAbilities.set(!store.showBossAbilities())"
        >
          <span class="dot"></span>Boss abilities
        </button>
        <button
          class="chip caret"
          (click)="pickerOpen.set(!pickerOpen())"
          title="Choose boss abilities"
        >
          {{ selectionSummary() }} ▾
        </button>
        @if (pickerOpen()) {
          <div class="picker" (mouseleave)="pickerOpen.set(false)">
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

      <span class="spacer"></span>

      <div class="zoom">
        <button (click)="zoom(-1)" [disabled]="store.pxPerSecond() <= 1">−</button>
        <span>{{ store.pxPerSecond() }}x</span>
        <button (click)="zoom(1)" [disabled]="store.pxPerSecond() >= 12">+</button>
      </div>
    </div>
  `,
  styles: `
    .bar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      position: relative;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12.5px;
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

    .divider {
      width: 1px;
      height: 20px;
      background: var(--border);
      margin: 0 4px;
    }

    .boss-filter {
      position: relative;
      display: inline-flex;
      gap: 4px;
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
  protected readonly categories = CATEGORIES;
  protected readonly pickerOpen = signal(false);
  protected readonly iconUrl = abilityIconUrl;

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
}
