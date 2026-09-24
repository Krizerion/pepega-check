import { Directive, Injectable, afterNextRender, inject } from '@angular/core';

interface WowheadPower {
  refreshLinks?: () => void;
}

declare global {
  interface Window {
    $WowheadPower?: WowheadPower;
  }
}

/**
 * Wowhead's tooltip widget (loaded in index.html) only scans the DOM on load,
 * so links this app renders later need an explicit rescan. Rescans are
 * coalesced into one call per tick — the widget re-walks the whole document.
 */
@Injectable({ providedIn: 'root' })
export class WowheadTooltips {
  private scheduled = false;

  refresh(): void {
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      window.$WowheadPower?.refreshLinks?.();
    });
  }
}

/**
 * Attaches a Wowhead tooltip to a link pointing at wowhead.com.
 *
 * Anchors only: the widget also accepts a `data-wowhead` attribute on arbitrary
 * elements, but tooltips triggered that way build their content and then render
 * at zero height, so buttons keep a plain `title` instead.
 */
@Directive({ selector: 'a[appWowhead]' })
export class WowheadLink {
  constructor() {
    const tooltips = inject(WowheadTooltips);
    afterNextRender(() => tooltips.refresh());
  }
}
