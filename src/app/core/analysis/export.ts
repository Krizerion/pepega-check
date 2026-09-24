import { formatOffset } from '../models/wcl';
import { AvoidableRow, DeathRow, LeaderboardRow, UtilityRow } from './types';

/** Discord rejects messages over 2000 characters, so lists are capped. */
const MAX_ROWS = 6;
export const DISCORD_LIMIT = 2000;

export interface SummaryInput {
  title: string;
  subtitle: string;
  /** Shareable link back to this exact view. */
  url: string;
  scope: 'pull' | 'all';
  summary: string[];
  deaths: DeathRow[];
  leaderboard: LeaderboardRow[];
  avoidable: AvoidableRow[];
  utility: UtilityRow[];
}

function short(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${Math.round(value)}`;
}

function section(title: string, lines: string[]): string[] {
  return lines.length > 0 ? ['', `**${title}**`, ...lines] : [];
}

/** Builds a Discord-pasteable recap of the current analysis view. */
export function buildSummaryMarkdown(input: SummaryInput): string {
  const lines: string[] = [`**${input.title}** — ${input.subtitle}`];

  for (const line of input.summary) {
    lines.push(line);
  }

  if (input.scope === 'pull') {
    lines.push(
      ...section(
        'Deaths',
        input.deaths
          .slice(0, MAX_ROWS)
          .map(
            (d) =>
              `${formatOffset(d.timeMs)} — ${d.playerName} to ${d.abilityName}` +
              (d.mitigation
                ? ` (used ${d.mitigation.name} ${d.mitigation.secondsBefore}s before)`
                : d.available.length > 0
                  ? ` — nothing pressed, had ${d.available.map((a) => a.name).join(', ')}`
                  : ' — nothing pressed'),
          ),
      ),
    );
  } else {
    lines.push(
      ...section(
        'Deaths across pulls',
        input.leaderboard
          .slice(0, MAX_ROWS)
          .map(
            (row) =>
              `${row.name}: ${row.deaths}` +
              (row.unmitigated > 0 ? ` (${row.unmitigated} with nothing pressed)` : ''),
          ),
      ),
    );
  }

  lines.push(
    ...section(
      'Most avoidable damage taken',
      [...input.avoidable]
        .sort((a, b) => b.damage - a.damage)
        .slice(0, MAX_ROWS)
        .map((row) => `${row.name}: ${short(row.damage)} over ${row.hits} hits`),
    ),
  );

  const noPots = input.utility.filter((row) => row.combatPots === 0).map((row) => row.name);
  if (noPots.length > 0) {
    lines.push('', `**No combat potion:** ${noPots.join(', ')}`);
  }

  lines.push('', input.url);

  const text = lines.join('\n');
  return text.length > DISCORD_LIMIT
    ? `${text.slice(0, DISCORD_LIMIT - 60).trimEnd()}\n… (truncated)\n${input.url}`
    : text;
}
