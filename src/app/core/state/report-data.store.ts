import { Injectable, inject, signal } from '@angular/core';

import { WclApiService } from '../api/wcl-api.service';
import { DEMO_REPORT_CODE, buildDemoPerformance, buildDemoReport } from '../data/demo-report';
import {
  DamageEvent,
  DispelEvent,
  FightEvents,
  FightPerformance,
  HealEvent,
  PlayerInfo,
  Report,
  ReportFight,
} from '../models/wcl';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Everything fetched from Warcraft Logs, and nothing about what the user is
 * currently looking at. Each `ensureX` loads a fight's data at most once and
 * de-duplicates concurrent callers; selection and filtering live in ReportStore.
 */
@Injectable({ providedIn: 'root' })
export class ReportDataStore {
  private readonly api = inject(WclApiService);

  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly report = signal<Report | null>(null);
  readonly players = signal<PlayerInfo[]>([]);

  private readonly eventsByFight = signal<ReadonlyMap<number, FightEvents>>(new Map());
  readonly events = this.eventsByFight.asReadonly();
  readonly loadingFights = signal<ReadonlySet<number>>(new Set());

  readonly damageByFight = signal<ReadonlyMap<number, DamageEvent[]>>(new Map());
  readonly dispelsByFight = signal<ReadonlyMap<number, DispelEvent[]>>(new Map());
  readonly loadingDamage = signal<ReadonlySet<number>>(new Set());

  readonly performanceByFight = signal<ReadonlyMap<number, FightPerformance>>(new Map());

  /** Loaded per pull on demand: healing is the chattiest stream in a log. */
  readonly healingByFight = signal<ReadonlyMap<number, HealEvent[]>>(new Map());
  readonly loadingHealing = signal<ReadonlySet<number>>(new Set());
  /** Pulls whose healing fetch failed, so the UI can offer a retry. */
  readonly failedHealing = signal<ReadonlySet<number>>(new Set());

  /**
   * Bumped whenever the held report is replaced. A fetch started for the old
   * report can still be in flight when the new one arrives; without this, its
   * result would land in the new report's map under the same fight id.
   */
  private generation = 0;

  private readonly inflightEvents = new Map<number, Promise<void>>();
  private readonly inflightDamage = new Map<number, Promise<void>>();
  private readonly inflightPerformance = new Map<number, Promise<void>>();
  private readonly inflightHealing = new Map<number, Promise<void>>();

  private demoEvents: Map<number, FightEvents> | null = null;
  private demoDamage: Map<number, DamageEvent[]> | null = null;
  private demoDispels: Map<number, DispelEvent[]> | null = null;
  private demoHealing: Map<number, HealEvent[]> | null = null;
  private readonly playerDetailsCache = new Map<string, PlayerInfo[]>();

  eventsFor(fightId: number): FightEvents | null {
    return this.eventsByFight().get(fightId) ?? null;
  }

  /** Loads a report's overview, replacing anything previously held. */
  async loadReport(code: string): Promise<boolean> {
    this.status.set('loading');
    this.error.set(null);
    this.reset();

    try {
      if (code === DEMO_REPORT_CODE) {
        const demo = buildDemoReport();
        this.report.set(demo.report);
        this.players.set(demo.players);
        this.demoEvents = demo.eventsByFight;
        this.demoDamage = demo.damageByFight;
        this.demoDispels = demo.dispelsByFight;
        this.demoHealing = demo.healingByFight;
      } else {
        const report = await this.api.fetchReport(code);
        if (report.fights.length === 0) {
          throw new Error('This report contains no boss encounters.');
        }
        this.report.set(report);
      }
      this.status.set('ready');
      return true;
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Failed to load the report.');
      return false;
    }
  }

  /**
   * Roster for an encounter, cached per encounter key.
   *
   * Never rejects: this sits in the middle of the load chain, and a rejection
   * here used to escape all the way out of an async event handler, leaving an
   * empty view and no explanation. Nothing is cached on failure, so simply
   * re-selecting the encounter retries.
   */
  async ensurePlayers(key: string, fightIds: number[]): Promise<void> {
    const report = this.report();
    if (!report || report.code === DEMO_REPORT_CODE) {
      return;
    }
    const gen = this.generation;
    try {
      const cached = this.playerDetailsCache.get(key);
      const players = cached ?? (await this.api.fetchPlayerDetails(report.code, fightIds));
      if (!cached) {
        this.playerDetailsCache.set(key, players);
      }
      this.ifCurrent(gen, () => this.players.set(players));
    } catch (e) {
      this.ifCurrent(gen, () =>
        this.error.set(
          e instanceof Error ? e.message : 'Failed to load the roster for this encounter.',
        ),
      );
    }
  }

  async ensureEvents(fightId: number): Promise<void> {
    await this.once(this.inflightEvents, fightId, this.eventsByFight().has(fightId), () =>
      this.fetchEvents(fightId),
    );
  }

  async ensureDamage(fightId: number): Promise<void> {
    await this.once(this.inflightDamage, fightId, this.damageByFight().has(fightId), () =>
      this.fetchDamage(fightId),
    );
  }

  async ensureHealing(fightId: number): Promise<void> {
    await this.once(this.inflightHealing, fightId, this.healingByFight().has(fightId), () =>
      this.fetchHealing(fightId),
    );
  }

  async ensurePerformance(fightId: number): Promise<void> {
    await this.once(this.inflightPerformance, fightId, this.performanceByFight().has(fightId), () =>
      this.fetchPerformance(fightId),
    );
  }

  /** Runs `task` once per fight, sharing the promise with concurrent callers. */
  private async once(
    inflight: Map<number, Promise<void>>,
    fightId: number,
    alreadyLoaded: boolean,
    task: () => Promise<void>,
  ): Promise<void> {
    if (alreadyLoaded) {
      return;
    }
    const existing = inflight.get(fightId);
    if (existing) {
      return existing;
    }
    const started = task();
    inflight.set(fightId, started);
    try {
      await started;
    } finally {
      inflight.delete(fightId);
    }
  }

  private fightFor(fightId: number): { report: Report; fight: ReportFight } | null {
    const report = this.report();
    const fight = report?.fights.find((f) => f.id === fightId);
    return report && fight ? { report, fight } : null;
  }

  /** Applies `write` only if the report has not been replaced since `gen`. */
  private ifCurrent(gen: number, write: () => void): void {
    if (gen === this.generation) {
      write();
    }
  }

  private async fetchEvents(fightId: number): Promise<void> {
    const target = this.fightFor(fightId);
    if (!target) {
      return;
    }
    const gen = this.generation;
    this.loadingFights.update((set) => new Set(set).add(fightId));
    try {
      const events =
        this.demoEvents?.get(fightId) ??
        (await this.api.fetchFightEvents(target.report.code, target.fight));
      this.ifCurrent(gen, () =>
        this.eventsByFight.update((map) => new Map(map).set(fightId, events)),
      );
    } catch (e) {
      this.ifCurrent(gen, () =>
        this.error.set(e instanceof Error ? e.message : 'Failed to load fight events.'),
      );
    } finally {
      this.loadingFights.update((set) => {
        const next = new Set(set);
        next.delete(fightId);
        return next;
      });
    }
  }

  private async fetchDamage(fightId: number): Promise<void> {
    const target = this.fightFor(fightId);
    if (!target) {
      return;
    }
    const { report, fight } = target;
    const gen = this.generation;
    this.loadingDamage.update((set) => new Set(set).add(fightId));
    try {
      const isDemo = report.code === DEMO_REPORT_CODE;
      const [damage, dispels] = await Promise.all([
        this.demoDamage?.get(fightId) ?? this.api.fetchDamageTaken(report.code, fight),
        isDemo
          ? Promise.resolve(this.demoDispels?.get(fightId) ?? [])
          : this.api.fetchDispels(report.code, fight),
      ]);
      this.ifCurrent(gen, () => {
        this.damageByFight.update((map) => new Map(map).set(fightId, damage));
        this.dispelsByFight.update((map) => new Map(map).set(fightId, dispels));
      });
    } catch (e) {
      this.ifCurrent(gen, () =>
        this.error.set(e instanceof Error ? e.message : 'Failed to load damage events.'),
      );
    } finally {
      this.loadingDamage.update((set) => {
        const next = new Set(set);
        next.delete(fightId);
        return next;
      });
    }
  }

  private async fetchHealing(fightId: number): Promise<void> {
    const target = this.fightFor(fightId);
    if (!target) {
      return;
    }
    const { report, fight } = target;
    const gen = this.generation;
    this.loadingHealing.update((set) => new Set(set).add(fightId));
    this.failedHealing.update((set) => without(set, fightId));
    try {
      const healing =
        this.demoHealing?.get(fightId) ?? (await this.api.fetchHealing(report.code, fight));
      this.ifCurrent(gen, () =>
        this.healingByFight.update((map) => new Map(map).set(fightId, healing)),
      );
    } catch (e) {
      // The death log keys "still loading" off the absence of a result, so a
      // failure has to be recorded explicitly or its spinner never stops.
      this.ifCurrent(gen, () => {
        this.failedHealing.update((set) => new Set(set).add(fightId));
        this.error.set(e instanceof Error ? e.message : 'Failed to load healing events.');
      });
    } finally {
      this.loadingHealing.update((set) => without(set, fightId));
    }
  }

  /** Forgets a failed healing fetch so `ensureHealing` will try again. */
  retryHealing(fightId: number): void {
    this.failedHealing.update((set) => without(set, fightId));
    void this.ensureHealing(fightId);
  }

  private async fetchPerformance(fightId: number): Promise<void> {
    const target = this.fightFor(fightId);
    if (!target) {
      return;
    }
    const { report, fight } = target;
    const gen = this.generation;
    try {
      const performance =
        report.code === DEMO_REPORT_CODE
          ? buildDemoPerformance(fight, this.players())
          : await this.api.fetchPerformance(report.code, fight);
      this.ifCurrent(gen, () =>
        this.performanceByFight.update((map) => new Map(map).set(fightId, performance)),
      );
    } catch (e) {
      this.ifCurrent(gen, () =>
        this.error.set(e instanceof Error ? e.message : 'Failed to load performance data.'),
      );
    }
  }

  private reset(): void {
    // Anything already in flight belongs to the outgoing report from here on.
    this.generation++;
    this.report.set(null);
    this.players.set([]);
    this.eventsByFight.set(new Map());
    this.damageByFight.set(new Map());
    this.dispelsByFight.set(new Map());
    this.performanceByFight.set(new Map());
    this.healingByFight.set(new Map());
    this.loadingHealing.set(new Set());
    this.failedHealing.set(new Set());
    this.inflightEvents.clear();
    this.inflightDamage.clear();
    this.inflightPerformance.clear();
    this.inflightHealing.clear();
    this.playerDetailsCache.clear();
    this.demoEvents = null;
    this.demoDamage = null;
    this.demoDispels = null;
    this.demoHealing = null;
  }

  fail(message: string): void {
    this.status.set('error');
    this.error.set(message);
  }
}

/** A copy of `set` without `value`. */
function without<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  next.delete(value);
  return next;
}
