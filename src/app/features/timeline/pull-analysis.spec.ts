import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideToastr } from 'ngx-toastr';

import { AnalysisScope, ReportStore, groupKey } from '../../core/state/report-store';
import { PullAnalysis } from './pull-analysis';

/**
 * The panel keeps a hand-maintained list of its collapsible cards, and both
 * collapse-all and the header's jump links read it. A card missing from that
 * list is a card they silently ignore — which is what happened when the
 * readiness and raid-cooldown cards were added. These tests render the panel
 * and compare what is actually on screen against what it registered.
 */
interface Internals {
  sections: () => { id: string; label: string }[];
}

function internals(fixture: ComponentFixture<PullAnalysis>): Internals {
  return fixture.componentInstance as unknown as Internals;
}

/** Every card the panel actually rendered, by its anchor. */
function renderedSections(fixture: ComponentFixture<PullAnalysis>): string[] {
  const host = fixture.nativeElement as HTMLElement;
  return [...host.querySelectorAll<HTMLElement>('[data-section]')].map(
    (el) => el.dataset['section'] ?? '',
  );
}

async function openPanel(scope: AnalysisScope): Promise<ComponentFixture<PullAnalysis>> {
  const store = TestBed.inject(ReportStore);
  await store.loadReport('DEMO');
  const encounter = store.encounters().at(-1);
  await store.selectEncounter(groupKey(encounter!));
  store.showAnalysis.set(true);
  store.analysisScope.set(scope);

  const fixture = TestBed.createComponent(PullAnalysis);
  // The panel loads damage, performance and readiness through effects, each of
  // which settles on a later tick, so the card list grows for a few rounds.
  for (let i = 0; i < 12; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  return fixture;
}

describe('analysis panel sections', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideToastr()],
    });
  });

  for (const scope of ['pull', 'all'] as const) {
    describe(`${scope} scope`, () => {
      it('registers every card it renders', async () => {
        const fixture = await openPanel(scope);
        const registered = new Set(
          internals(fixture)
            .sections()
            .map((s) => s.id),
        );

        const unregistered = renderedSections(fixture).filter((id) => !registered.has(id));

        expect(unregistered).toEqual([]);
      });

      it('renders every card it registered', async () => {
        const fixture = await openPanel(scope);
        const rendered = new Set(renderedSections(fixture));

        const missing = internals(fixture)
          .sections()
          .map((s) => s.id)
          .filter((id) => !rendered.has(id));

        expect(missing).toEqual([]);
      });

      it('collapses and expands all of them together', async () => {
        const fixture = await openPanel(scope);
        const host = fixture.nativeElement as HTMLElement;
        const toggleAll = [...host.querySelectorAll('button')].find((b) =>
          /Collapse all|Expand all/.test(b.textContent ?? ''),
        );
        expect(toggleAll).toBeTruthy();
        expect(host.querySelectorAll('.card-body').length).toBeGreaterThan(0);

        toggleAll!.click();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        // Leave animations keep a body in the DOM briefly; those are on the way
        // out and carry the leave class, so they do not count as open.
        const stillOpen = [...host.querySelectorAll('.card-body')].filter(
          (el) => !el.classList.contains('body-leave'),
        );
        expect(stillOpen).toEqual([]);
      });
    });
  }

  it('gives every section a non-empty jump label', async () => {
    const fixture = await openPanel('pull');

    for (const section of internals(fixture).sections()) {
      expect(section.label.trim()).not.toBe('');
    }
  });
});
