import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { WclApiService } from '../api/wcl-api.service';
import { PlayerInfo, Report, ReportFight } from '../models/wcl';
import { ReportDataStore } from './report-data.store';

function fight(id: number): ReportFight {
  return {
    id,
    name: 'Boss',
    encounterID: 1,
    difficulty: 5,
    kill: false,
    startTime: 0,
    endTime: 10_000,
    fightPercentage: 20,
    lastPhase: 1,
    size: 20,
  };
}

function report(code: string): Report {
  return {
    code,
    title: `Report ${code}`,
    startTime: 0,
    endTime: 10_000,
    zoneName: 'Zone',
    fights: [fight(1)],
    actors: [],
    abilities: new Map(),
  };
}

/** A promise plus the handles to settle it from the test. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ReportDataStore', () => {
  let api: {
    fetchReport: ReturnType<typeof vi.fn>;
    fetchFightEvents: ReturnType<typeof vi.fn>;
    fetchHealing: ReturnType<typeof vi.fn>;
    fetchPlayerDetails: ReturnType<typeof vi.fn>;
  };
  let store: ReportDataStore;

  beforeEach(() => {
    api = {
      fetchReport: vi.fn(),
      fetchFightEvents: vi.fn(),
      fetchHealing: vi.fn(),
      fetchPlayerDetails: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: WclApiService, useValue: api }],
    });
    store = TestBed.inject(ReportDataStore);
  });

  describe('loading a different report mid-flight', () => {
    it('drops events that arrive after the report was replaced', async () => {
      const slow = deferred<{ friendlyCasts: []; enemyCasts: []; deaths: [] }>();
      api.fetchReport.mockResolvedValue(report('AAA'));
      api.fetchFightEvents.mockReturnValue(slow.promise);

      await store.loadReport('AAA');
      const inFlight = store.ensureEvents(1);

      // The user pastes a different report before the first fight comes back.
      api.fetchReport.mockResolvedValue(report('BBB'));
      await store.loadReport('BBB');

      slow.resolve({ friendlyCasts: [], enemyCasts: [], deaths: [] });
      await inFlight;

      expect(store.events().has(1)).toBe(false);
    });

    it('drops a roster that arrives after the report was replaced', async () => {
      const slow = deferred<PlayerInfo[]>();
      api.fetchReport.mockResolvedValue(report('AAA'));
      api.fetchPlayerDetails.mockReturnValue(slow.promise);

      await store.loadReport('AAA');
      const inFlight = store.ensurePlayers('1:5', [1]);

      api.fetchReport.mockResolvedValue(report('BBB'));
      await store.loadReport('BBB');

      slow.resolve([{ id: 7, name: 'Ghost', className: 'Mage', spec: 'Fire', role: 'dps' }]);
      await inFlight;

      expect(store.players()).toEqual([]);
    });

    it('keeps events that arrive while the same report is still open', async () => {
      const slow = deferred<{ friendlyCasts: []; enemyCasts: []; deaths: [] }>();
      api.fetchReport.mockResolvedValue(report('AAA'));
      api.fetchFightEvents.mockReturnValue(slow.promise);

      await store.loadReport('AAA');
      const inFlight = store.ensureEvents(1);
      slow.resolve({ friendlyCasts: [], enemyCasts: [], deaths: [] });
      await inFlight;

      expect(store.events().has(1)).toBe(true);
    });
  });

  describe('healing failures', () => {
    beforeEach(async () => {
      api.fetchReport.mockResolvedValue(report('AAA'));
      await store.loadReport('AAA');
    });

    it('records the failure and stops loading, rather than hanging', async () => {
      api.fetchHealing.mockRejectedValue(new Error('rate limited'));

      await store.ensureHealing(1);

      expect(store.failedHealing().has(1)).toBe(true);
      expect(store.loadingHealing().has(1)).toBe(false);
      expect(store.healingByFight().has(1)).toBe(false);
      expect(store.error()).toBe('rate limited');
    });

    it('clears the failure and refetches on retry', async () => {
      api.fetchHealing.mockRejectedValueOnce(new Error('rate limited'));
      await store.ensureHealing(1);

      api.fetchHealing.mockResolvedValue([]);
      store.retryHealing(1);
      await store.ensureHealing(1);

      expect(store.failedHealing().has(1)).toBe(false);
      expect(store.healingByFight().has(1)).toBe(true);
    });

    it('marks the pull as loading while the fetch is outstanding', async () => {
      const slow = deferred<[]>();
      api.fetchHealing.mockReturnValue(slow.promise);

      const inFlight = store.ensureHealing(1);
      expect(store.loadingHealing().has(1)).toBe(true);

      slow.resolve([]);
      await inFlight;
      expect(store.loadingHealing().has(1)).toBe(false);
    });
  });

  describe('roster failures', () => {
    it('surfaces the error instead of rejecting', async () => {
      api.fetchReport.mockResolvedValue(report('AAA'));
      await store.loadReport('AAA');
      api.fetchPlayerDetails.mockRejectedValue(new Error('network died'));

      await expect(store.ensurePlayers('1:5', [1])).resolves.toBeUndefined();
      expect(store.error()).toBe('network died');
    });

    it('retries on the next call, having cached nothing', async () => {
      api.fetchReport.mockResolvedValue(report('AAA'));
      await store.loadReport('AAA');
      api.fetchPlayerDetails.mockRejectedValueOnce(new Error('network died'));
      await store.ensurePlayers('1:5', [1]);

      const roster: PlayerInfo[] = [
        { id: 7, name: 'Maity', className: 'Priest', spec: 'Holy', role: 'healer' },
      ];
      api.fetchPlayerDetails.mockResolvedValue(roster);
      await store.ensurePlayers('1:5', [1]);

      expect(store.players()).toEqual(roster);
    });
  });
});
