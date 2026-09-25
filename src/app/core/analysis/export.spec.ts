import { DISCORD_LIMIT, SummaryInput, buildSummaryMarkdown } from './export';
import { AvoidableRow, DeathRow, LeaderboardRow, UtilityRow } from './types';

const death = (over: Partial<DeathRow> = {}): DeathRow => ({
  timeMs: 65_000,
  playerId: 1,
  playerName: 'Dee',
  playerColor: '#fff',
  abilityName: 'Floor Spike',
  abilityIcon: '',
  abilityUrl: null,
  mitigation: null,
  available: [],
  timeline: [],
  steps: [],
  damageTaken: 0,
  hpTrace: [],
  hpStart: null,
  hpStartRaw: null,
  maxHp: null,
  healers: [],
  healingReceived: 0,
  ...over,
});

const utility = (name: string, combatPots: number): UtilityRow => ({
  name,
  color: '#fff',
  defensives: 0,
  raidCds: 0,
  combatPots,
  healthPots: 0,
  dispels: 0,
  deaths: 0,
});

const avoidable = (name: string, damage: number): AvoidableRow => ({
  name,
  color: '#fff',
  damage,
  hits: 3,
  perPull: damage,
  pct: 100,
  mechanics: [],
});

const base: SummaryInput = {
  title: 'Pull 6',
  subtitle: '8:39 · Wipe at 15% · P3',
  url: 'https://example.test/#code=ABC&pull=6',
  scope: 'pull',
  summary: ['Wiped at 8:39 — boss at 15% (P3).'],
  deaths: [death()],
  leaderboard: [],
  avoidable: [avoidable('Dee', 1_200_000)],
  utility: [utility('Dee', 0), utility('Tanky', 1)],
};

describe('buildSummaryMarkdown', () => {
  it('leads with the title, subtitle and summary lines', () => {
    const text = buildSummaryMarkdown(base);
    expect(text.startsWith('**Pull 6** — 8:39 · Wipe at 15% · P3')).toBe(true);
    expect(text).toContain('Wiped at 8:39');
  });

  it('spells out what a dead player had available', () => {
    const text = buildSummaryMarkdown({
      ...base,
      deaths: [death({ available: [{ id: 1, name: 'Barkskin', icon: '' }] })],
    });
    expect(text).toContain('1:05 — Dee to Floor Spike — nothing pressed, had Barkskin');
  });

  it('reports a mitigation when one was used', () => {
    const text = buildSummaryMarkdown({
      ...base,
      deaths: [death({ mitigation: { name: 'Barkskin', icon: '', secondsBefore: 4 } })],
    });
    expect(text).toContain('(used Barkskin 4s before)');
  });

  it('switches to the leaderboard when scoped to all pulls', () => {
    const leaderboard: LeaderboardRow[] = [
      { name: 'Dee', color: '#fff', deaths: 4, unmitigated: 2 },
    ];
    const text = buildSummaryMarkdown({ ...base, scope: 'all', leaderboard });
    expect(text).toContain('Deaths across pulls');
    expect(text).toContain('Dee: 4 (2 with nothing pressed)');
  });

  it('names who skipped a combat potion', () => {
    expect(buildSummaryMarkdown(base)).toContain('**No combat potion:** Dee');
  });

  it('omits the potion line when everyone potted', () => {
    const text = buildSummaryMarkdown({ ...base, utility: [utility('Dee', 1)] });
    expect(text).not.toContain('No combat potion');
  });

  it('always ends with the shareable link', () => {
    expect(buildSummaryMarkdown(base).trimEnd().endsWith(base.url)).toBe(true);
  });

  it('stays within Discord’s message limit', () => {
    const many = Array.from({ length: 60 }, (_, i) => avoidable(`Raider${i}`, 5_000_000 - i));
    const text = buildSummaryMarkdown({
      ...base,
      avoidable: many,
      utility: Array.from({ length: 60 }, (_, i) => utility(`Raider${i}`, 0)),
    });
    expect(text.length).toBeLessThanOrEqual(DISCORD_LIMIT);
    expect(text).toContain(base.url);
  });
});
