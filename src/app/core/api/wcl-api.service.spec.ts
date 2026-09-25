import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideToastr } from 'ngx-toastr';

import { ReportFight } from '../models/wcl';
import { WclApiService } from './wcl-api.service';
import { WclAuthService } from './wcl-auth.service';

const FIGHT: ReportFight = {
  id: 1,
  name: 'Boss',
  encounterID: 1,
  difficulty: 5,
  kill: false,
  startTime: 0,
  endTime: 10_000,
  fightPercentage: 10,
  lastPhase: 1,
  size: 20,
};

/** A successful events page. */
function page(data: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: { reportData: { report: { events: { data, nextPageTimestamp: null } } } },
      }),
  } as unknown as Response;
}

/** A GraphQL-level error, which the API returns with HTTP 200. */
function graphQlError(message: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ errors: [{ message }] }),
  } as unknown as Response;
}

function bodyOf(call: unknown[]): { query: string; variables: Record<string, unknown> } {
  return JSON.parse((call[1] as RequestInit).body as string) as {
    query: string;
    variables: Record<string, unknown>;
  };
}

describe('WclApiService health resources', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: WclApiService;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideToastr(),
        { provide: WclAuthService, useValue: { getAccessToken: () => Promise.resolve('token') } },
      ],
    });
    api = TestBed.inject(WclApiService);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('asks for resources on damage, which is where health comes from', async () => {
    fetchMock.mockResolvedValue(page([]));

    await api.fetchDamageTaken('AAA', FIGHT);

    expect(bodyOf(fetchMock.mock.calls[0]).query).toContain('includeResources: true');
  });

  it('does not ask for resources on casts, which do not use them', async () => {
    fetchMock.mockResolvedValue(page([]));

    await api.fetchFightEvents('AAA', FIGHT);

    for (const call of fetchMock.mock.calls) {
      expect(bodyOf(call).query).not.toContain('includeResources');
    }
  });

  it('lifts the target health Warcraft Logs nests under targetResources', async () => {
    fetchMock.mockResolvedValue(
      page([
        {
          timestamp: 500,
          sourceID: 9,
          targetID: 3,
          abilityGameID: 42,
          amount: 1000,
          targetResources: { hitPoints: 4000, maxHitPoints: 10_000 },
        },
      ]),
    );

    const [hit] = await api.fetchDamageTaken('AAA', FIGHT);

    expect(hit.hitPoints).toBe(4000);
    expect(hit.maxHitPoints).toBe(10_000);
  });

  it('does the same for healing', async () => {
    fetchMock.mockResolvedValue(
      page([
        {
          timestamp: 500,
          sourceID: 7,
          targetID: 3,
          abilityGameID: 99,
          amount: 800,
          targetResources: { hitPoints: 9000, maxHitPoints: 10_000 },
        },
      ]),
    );

    const [heal] = await api.fetchHealing('AAA', FIGHT);

    expect(heal.hitPoints).toBe(9000);
    expect(heal.maxHitPoints).toBe(10_000);
  });

  it('keeps flat health when the event already carries it', async () => {
    fetchMock.mockResolvedValue(
      page([
        {
          timestamp: 500,
          sourceID: 9,
          targetID: 3,
          abilityGameID: 42,
          amount: 1000,
          hitPoints: 1234,
          maxHitPoints: 5000,
        },
      ]),
    );

    const [hit] = await api.fetchDamageTaken('AAA', FIGHT);

    expect(hit.hitPoints).toBe(1234);
  });

  it('retries without resources if the API rejects the argument', async () => {
    fetchMock
      .mockResolvedValueOnce(graphQlError('Unknown argument "includeResources" on field "events".'))
      .mockResolvedValue(page([{ timestamp: 1, sourceID: 9, targetID: 3, abilityGameID: 42 }]));

    const hits = await api.fetchDamageTaken('AAA', FIGHT);

    // The events still arrive; only the health trace is lost.
    expect(hits).toHaveLength(1);
    expect(bodyOf(fetchMock.mock.calls[1]).query).not.toContain('includeResources');
  });

  it('still surfaces unrelated errors instead of silently retrying', async () => {
    fetchMock.mockResolvedValue(graphQlError('This report is private.'));

    await expect(api.fetchDamageTaken('AAA', FIGHT)).rejects.toThrow(/private/);
  });
});

/** A failed HTTP response, with headers the retry logic reads. */
function httpError(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

describe('WclApiService rate limiting', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: WclApiService;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideToastr(),
        { provide: WclAuthService, useValue: { getAccessToken: () => Promise.resolve('token') } },
      ],
    });
    api = TestBed.inject(WclApiService);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('waits out a 429 and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(429, { 'Retry-After': '0' }))
      .mockResolvedValue(page([]));

    await expect(api.fetchDamageTaken('AAA', FIGHT)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries transient server faults too', async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(503, { 'Retry-After': '0' }))
      .mockResolvedValue(page([]));

    await expect(api.fetchDamageTaken('AAA', FIGHT)).resolves.toEqual([]);
  });

  it('gives up eventually, and says what happened', async () => {
    fetchMock.mockResolvedValue(httpError(429, { 'Retry-After': '0' }));

    await expect(api.fetchDamageTaken('AAA', FIGHT)).rejects.toThrow(/rate-limiting/i);
    // Four attempts total, not an unbounded loop.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('never retries a rejected token', async () => {
    fetchMock.mockResolvedValue(httpError(401));

    await expect(api.fetchDamageTaken('AAA', FIGHT)).rejects.toThrow(/access token/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a request that will never succeed', async () => {
    fetchMock.mockResolvedValue(httpError(400));

    await expect(api.fetchDamageTaken('AAA', FIGHT)).rejects.toThrow(/failed \(400\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
