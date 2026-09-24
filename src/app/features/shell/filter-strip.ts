import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CATEGORIES } from '../../core/data/ability-catalog';
import { abilityIconUrl } from '../../core/data/wow';
import { PlayerRole } from '../../core/models/wcl';
import { CategoryAbilities, ReportStore } from '../../core/state/report-store';
import { WowheadLink } from '../../core/wowhead/wowhead-tooltip';

interface Anchor {
  kind: 'category' | 'boss';
  id: string;
  x: number;
  y: number;
}

/**
 * Filters, inline and always visible.
 *
 * The old filter bar put every individual spell icon on screen at once — 38 of
 * them — and cost 172px of height. Hiding the lot behind a button fixed the
 * height but made an active filter invisible, so missing rows looked like
 * broken data.
 *
 * The split here is by how often a control is used. Toggling a whole category
 * or a role is the common action, so those are chips you can see and hit
 * directly. Hiding one specific spell, or picking individual boss abilities, is
 * rare, so it sits behind a caret on the chip it belongs to. One row, fixed
 * height, scrolls sideways when it does not fit.
 */
@Component({
  selector: 'app-filter-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WowheadLink],
  host: { '(document:keydown.escape)': 'anchor.set(null)' },
  template: `
    <div class="strip">
      <div class="group" role="group" aria-label="Roles">
        @for (role of roles; track role.id) {
          <button
            class="chip"
            [class.on]="store.enabledRoles().has(role.id)"
            [style.--chip-color]="role.color"
            (click)="store.toggleRole(role.id)"
            [title]="'Show ' + role.label"
          >
            <span class="ri">{{ role.icon }}</span>
            <span class="rl">{{ role.label }}</span>
          </button>
        }
      </div>

      <span class="sep"></span>

      <div class="group" role="group" aria-label="Ability categories">
        <button
          class="chip master"
          [class.on]="anyCategoryOn()"
          (click)="store.toggleAllCategories()"
          title="Toggle every category"
        >
          All
        </button>

        @for (cat of categories(); track cat.meta.id) {
          <span class="cat" [style.--chip-color]="cat.meta.color">
            <button
              class="chip cat-main"
              [class.on]="store.enabledCategories().has(cat.meta.id)"
              (click)="store.toggleCategory(cat.meta.id)"
              [title]="'Toggle ' + cat.meta.label"
            >
              <span class="dot"></span>{{ cat.meta.label }}
              @if (hiddenIn(cat); as n) {
                <span class="tweaked" [title]="n + ' hidden'">−{{ n }}</span>
              }
            </button>
            <button
              class="caret"
              [class.open]="anchor()?.id === cat.meta.id"
              (click)="open('category', cat.meta.id, $event)"
              [attr.aria-label]="'Choose ' + cat.meta.label + ' abilities'"
            >
              ▾
            </button>
          </span>
        }
      </div>

      <span class="sep"></span>

      <div class="group" role="group" aria-label="Boss and deaths">
        <span class="cat" [style.--chip-color]="'#b17ae8'">
          <button
            class="chip cat-main"
            [class.on]="store.showBossAbilities()"
            (click)="store.showBossAbilities.set(!store.showBossAbilities())"
            title="Show the boss ability lane"
          >
            <span class="dot"></span>Boss
            @if (hiddenBoss(); as n) {
              <span class="tweaked" [title]="n + ' hidden'">−{{ n }}</span>
            }
          </button>
          <button
            class="caret"
            [class.open]="anchor()?.kind === 'boss'"
            (click)="open('boss', 'boss', $event)"
            aria-label="Choose boss abilities"
          >
            ▾
          </button>
        </span>

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

        <button
          class="chip"
          [class.on]="store.showDeaths()"
          [style.--chip-color]="'#e5484d'"
          (click)="store.showDeaths.set(!store.showDeaths())"
        >
          <span class="dot"></span>Deaths
        </button>

        <label class="ignore" title="Grey out everything after the Nth death">
          after
          <select
            [value]="store.ignoreAfterDeaths() ?? ''"
            (change)="setIgnoreDeaths(asSelect($event).value)"
          >
            <option value="">—</option>
            @for (n of deathOptions; track n) {
              <option [value]="n" [selected]="n === store.ignoreAfterDeaths()">{{ n }}</option>
            }
          </select>
          deaths
        </label>
      </div>

      @if (activeFilters(); as n) {
        <button class="reset" (click)="resetAll()" [title]="n + ' filters are hiding something'">
          ✕ Reset<span class="badge">{{ n }}</span>
        </button>
      }
    </div>

    @if (anchor(); as a) {
      <button class="scrim" (click)="anchor.set(null)" aria-label="Close" tabindex="-1"></button>
      <div class="pop" [style.left.px]="a.x" [style.top.px]="a.y">
        @if (a.kind === 'category') {
          @if (categoryFor(a.id); as cat) {
            <header>
              <span class="pop-title">{{ cat.meta.label }}</span>
              <button class="link" (click)="showAllIn(cat)">show all</button>
            </header>
            <div class="icons">
              @for (ability of cat.abilities; track ability.id) {
                <a
                  appWowhead
                  class="icon-btn"
                  [style.--chip-color]="cat.meta.color"
                  [class.hidden-ability]="!isShown(cat, ability.id)"
                  [href]="'https://www.wowhead.com/spell=' + ability.id"
                  target="_blank"
                  rel="noreferrer"
                  (click)="pickAbility($event, cat, ability.id)"
                  [attr.aria-pressed]="isShown(cat, ability.id)"
                  [attr.aria-label]="ability.name + ', ' + ability.count + ' casts'"
                >
                  <img [src]="iconUrl(ability.icon)" (error)="onIconError($event)" alt="" />
                </a>
              }
            </div>
          }
        } @else {
          <header>
            <span class="pop-title">Boss abilities</span>
            <button class="link" (click)="store.selectAllBossAbilities(true)">all</button>
            <button class="link" (click)="store.selectAllBossAbilities(false)">none</button>
          </header>
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
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      flex: 0 0 auto;
    }

    /* One row, fixed height, scrolls sideways rather than wrapping: wrapping is
       what let the old bar grow to 172px and push the data off screen. */
    .strip {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 5px 14px;
      /* Fades the right edge so a strip that continues past the viewport looks
         like it continues, rather than like it ends there. */
      mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent);
      background: var(--bg-1);
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: thin;
    }

    .strip::-webkit-scrollbar {
      height: 5px;
    }

    .group {
      display: flex;
      align-items: center;
      gap: 3px;
      flex: 0 0 auto;
    }

    .sep {
      flex: 0 0 auto;
      width: 1px;
      height: 18px;
      background: var(--border);
      margin: 0 2px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex: 0 0 auto;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      white-space: nowrap;
      background: var(--bg-2);
      color: var(--text-2);

      &.on {
        color: var(--text-0);
        border-color: var(--chip-color);
        background: color-mix(in srgb, var(--chip-color) 15%, transparent);

        .dot {
          background: var(--chip-color);
          opacity: 1;
        }
      }
    }

    .master {
      --chip-color: var(--accent);
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--text-2);
      opacity: 0.5;
    }

    /* A category chip and its disclosure read as one control. */
    .cat {
      display: inline-flex;
      align-items: stretch;
      flex: 0 0 auto;

      .cat-main {
        border-radius: 999px 0 0 999px;
        padding-right: 7px;
      }

      .caret {
        border-radius: 0 999px 999px 0;
        border-left: none;
        padding: 3px 7px;
        font-size: 9px;
        line-height: 1.6;
        color: var(--text-2);
        background: var(--bg-2);

        &:hover,
        &.open {
          color: var(--text-0);
          background: var(--bg-3);
        }
      }
    }

    /* Says the category is on but some of its spells are hidden — otherwise
       that refinement is invisible once the popover closes. */
    .tweaked {
      font-size: 10px;
      font-weight: 700;
      color: var(--warn);
    }

    .ignore {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
      font-size: 11.5px;
      color: var(--text-2);
      white-space: nowrap;

      select {
        padding: 1px 4px;
        font-size: 11.5px;
        background: var(--bg-2);
      }
    }

    .reset {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex: 0 0 auto;
      margin-left: auto;
      padding: 3px 9px;
      font-size: 11.5px;
      white-space: nowrap;
      border-color: var(--accent);
      background: var(--accent-soft);
    }

    .badge {
      min-width: 15px;
      padding: 0 4px;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      text-align: center;
    }

    /* ---------- popovers ---------- */

    .scrim {
      position: fixed;
      inset: 0;
      z-index: 60;
      padding: 0;
      border: none;
      border-radius: 0;
      background: none;
      cursor: default;

      &:hover:not(:disabled) {
        background: none;
        border-color: transparent;
      }
    }

    /* Fixed, positioned from the trigger's rect: the strip scrolls sideways, so
       a popover anchored inside it would be clipped by the overflow. */
    .pop {
      position: fixed;
      z-index: 61;
      width: max-content;
      max-width: min(340px, calc(100vw - 20px));
      background: var(--bg-1);
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      box-shadow: var(--shadow);
      padding: 8px;
      animation: pop 0.12s ease-out;
    }

    @keyframes pop {
      from {
        transform: translateY(-4px);
        opacity: 0;
      }
    }

    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 2px 7px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 7px;
    }

    .pop-title {
      flex: 1;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-2);
      white-space: nowrap;
    }

    .link {
      background: none;
      border: none;
      padding: 0 2px;
      font-size: 11px;
      text-decoration: underline;
      color: var(--accent);
    }

    .icons {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      max-width: 292px;
    }

    .icon-btn {
      display: block;
      padding: 0;
      width: 28px;
      height: 28px;
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
      max-height: 300px;
      overflow-y: auto;
      min-width: 240px;
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
      font-size: 11px;
      color: var(--text-2);
    }

    .pick-link {
      color: var(--text-2);
      text-decoration: none;
      padding: 0 2px;

      &:hover {
        color: var(--accent);
      }
    }

    .empty {
      margin: 2px 6px;
      font-size: 12px;
      color: var(--text-2);
    }

    @media (max-width: 1080px) {
      .rl {
        display: none;
      }

      .ri {
        font-size: 13px;
      }
    }

    @media (max-width: 720px) {
      .strip {
        padding: 5px 10px;
      }

      .reset {
        margin-left: 4px;
      }

      .pick-row {
        padding: 7px 6px;
      }
    }
  `,
})
export class FilterStrip {
  protected readonly store = inject(ReportStore);
  protected readonly iconUrl = abilityIconUrl;
  protected readonly deathOptions = [1, 2, 3, 4, 5, 8, 10];
  protected readonly anchor = signal<Anchor | null>(null);

  protected readonly roles: { id: PlayerRole; label: string; icon: string; color: string }[] = [
    { id: 'tank', label: 'Tanks', icon: '🛡️', color: '#5e9bff' },
    { id: 'healer', label: 'Healers', icon: '💚', color: '#46a758' },
    { id: 'dps', label: 'DPS', icon: '⚔️', color: '#e5484d' },
  ];

  /** Only categories this raid actually used; an empty one is noise. */
  protected readonly categories = computed(() =>
    this.store.abilitiesByCategory().filter((cat) => cat.abilities.length > 0),
  );

  protected readonly anyCategoryOn = computed(() => this.store.enabledCategories().size > 0);

  protected readonly activeFilters = computed(() => {
    let count = 0;
    if (this.store.enabledRoles().size < 3) {
      count++;
    }
    if (this.store.enabledCategories().size < CATEGORIES.length) {
      count++;
    }
    if (this.store.disabledAbilityIds().size > 0) {
      count++;
    }
    if (this.store.selectedBossAbilityIds() !== null) {
      count++;
    }
    if (!this.store.showBossAbilities()) {
      count++;
    }
    if (!this.store.showDeaths()) {
      count++;
    }
    if (this.store.ignoreAfterDeaths() !== null) {
      count++;
    }
    return count;
  });

  protected categoryFor(id: string): CategoryAbilities | undefined {
    return this.categories().find((cat) => cat.meta.id === id);
  }

  /**
   * Whether an ability actually shows on the timeline: its category has to be
   * on *and* the ability not individually hidden. The popover renders this
   * rather than the raw per-ability flag, so switching a category off greys out
   * everything inside it instead of leaving the icons looking selected.
   */
  protected isShown(cat: CategoryAbilities, abilityId: number): boolean {
    return (
      this.store.enabledCategories().has(cat.meta.id) &&
      !this.store.disabledAbilityIds().has(abilityId)
    );
  }

  /**
   * How many spells are individually hidden inside a category. Reported only
   * while the category is on: with it off the chip is already dimmed, and a
   * count there would just restate it.
   */
  protected hiddenIn(cat: CategoryAbilities): number {
    if (!this.store.enabledCategories().has(cat.meta.id)) {
      return 0;
    }
    const disabled = this.store.disabledAbilityIds();
    return cat.abilities.filter((ability) => disabled.has(ability.id)).length;
  }

  protected hiddenBoss(): number {
    const selected = this.store.selectedBossAbilityIds();
    if (!this.store.showBossAbilities() || selected === null) {
      return 0;
    }
    return this.store.bossAbilities().length - selected.size;
  }

  /**
   * Plain click toggles the ability; ctrl/cmd/shift-click follows the link to
   * Wowhead, which is why these are anchors rather than buttons — the tooltip
   * widget only attaches to real links.
   */
  protected pickAbility(event: MouseEvent, cat: CategoryAbilities, abilityId: number): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    this.toggleAbility(cat, abilityId);
  }

  /** Opens a popover under the control that was clicked, clamped on screen. */
  protected open(kind: Anchor['kind'], id: string, event: Event): void {
    if (this.anchor()?.id === id) {
      this.anchor.set(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = kind === 'boss' ? 260 : 310;
    this.anchor.set({
      kind,
      id,
      x: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      y: rect.bottom + 6,
    });
  }

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

  /** Clears per-ability hiding and switches the category back on. */
  protected showAllIn(cat: CategoryAbilities): void {
    const next = new Set(this.store.disabledAbilityIds());
    for (const ability of cat.abilities) {
      next.delete(ability.id);
    }
    this.store.disabledAbilityIds.set(next);
    this.store.enabledCategories.set(new Set([...this.store.enabledCategories(), cat.meta.id]));
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
}
