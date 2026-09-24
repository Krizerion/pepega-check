import { Injectable, effect, inject, untracked } from '@angular/core';

import { AnalysisScope, ReportStore, groupKey } from './report-store';

/**
 * Mirrors the current view into the URL so links are shareable and a refresh
 * lands back where you were.
 *
 * The state lives in the hash rather than the path because GitHub Pages serves
 * static files with no SPA rewrite: `/pepega-check/report/abc` would 404 on a
 * cold load, while `#code=abc` always resolves to index.html.
 */
@Injectable({ providedIn: 'root' })
export class UrlStateService {
  private readonly store = inject(ReportStore);
  /** Guards against the URL we just wrote being read back as a navigation. */
  private writing = false;
  private started = false;

  /** Applies any state in the URL, then keeps the URL in sync with the store. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    window.addEventListener('hashchange', () => {
      if (!this.writing) {
        void this.applyFromUrl();
      }
    });

    effect(() => {
      // Track everything worth sharing.
      const state = {
        code: this.store.report()?.code ?? null,
        encounter: this.store.selectedEncounterKey(),
        pull: this.store.selectedPullId(),
        player: this.store.selectedPlayerId(),
        analysis: this.store.showAnalysis(),
        scope: this.store.analysisScope(),
      };
      untracked(() => this.write(state));
    });

    void this.applyFromUrl();
  }

  private write(state: {
    code: string | null;
    encounter: string | null;
    pull: number | null;
    player: number | null;
    analysis: boolean;
    scope: AnalysisScope;
  }): void {
    if (!state.code) {
      return;
    }
    const params = new URLSearchParams();
    params.set('code', state.code);
    if (state.encounter) {
      params.set('enc', state.encounter);
    }
    if (state.pull !== null) {
      params.set('pull', String(state.pull));
    }
    if (state.player !== null) {
      params.set('player', String(state.player));
    }
    if (state.analysis) {
      params.set('analysis', state.scope);
    }

    const hash = `#${params.toString()}`;
    if (hash === window.location.hash) {
      return;
    }
    this.writing = true;
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    // hashchange fires asynchronously; clear the guard after it would have run.
    setTimeout(() => (this.writing = false));
  }

  /** Reads the hash and drives the store to match it. */
  private async applyFromUrl(): Promise<void> {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const code = params.get('code');
    if (!code) {
      return;
    }

    if (this.store.report()?.code !== code) {
      await this.store.loadReport(code);
      if (this.store.report()?.code !== code) {
        return; // load failed; the store already surfaced the error
      }
    }

    const encounter = params.get('enc');
    if (encounter && encounter !== this.store.selectedEncounterKey()) {
      const exists = this.store.encounters().some((e) => groupKey(e) === encounter);
      if (exists) {
        await this.store.selectEncounter(encounter);
      }
    }

    const pull = toId(params.get('pull'));
    if (pull !== null && this.store.selectedEncounter()?.pulls.some((p) => p.id === pull)) {
      await this.store.selectPull(pull);
    }

    const player = toId(params.get('player'));
    if (player !== null && this.store.players().some((p) => p.id === player)) {
      await this.store.selectPlayer(player);
    }

    const analysis = params.get('analysis');
    if (analysis === 'pull' || analysis === 'all') {
      this.store.analysisScope.set(analysis);
      this.store.showAnalysis.set(true);
    }
  }
}

function toId(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
