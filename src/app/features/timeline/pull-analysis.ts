import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { classifyAbility } from '../../core/data/ability-catalog';
import { abilityIconUrl, classColor } from '../../core/data/wow';
import { DeathEvent, ReportFight, formatOffset, killingAbilityId } from '../../core/models/wcl';
import { ReportStore } from '../../core/state/report-store';

/** Categories that count as "tried to survive" right before a death. */
const MITIGATION_CATEGORIES = new Set(['defensive', 'immunity', 'health-pot', 'healing-cd']);
const MITIGATION_WINDOW_MS = 12_000;

type AnalysisScope = 'pull' | 'all';

interface DeathRow {
  timeMs: number;
  playerId: number;
  playerName: string;
  playerColor: string;
  abilityName: string;
  abilityIcon: string;
  abilityUrl: string | null;
  mitigation: { name: string; icon: string; secondsBefore: number } | null;
}

interface PlayerHits {
  name: string;
  color: string;
  damage: number;
  hits: number;
  /** Bar width relative to the hardest-hit player, 0-100. */
  pct: number;
}

interface MechanicRow {
  id: number;
  name: string;
  icon: string;
  url: string;
  hits: number;
  playersHit: number;
  totalDamage: number;
  avgHit: number;
  perPlayer: PlayerHits[];
}

interface LeaderboardRow {
  name: string;
  color: string;
  deaths: number;
  unmitigated: number;
}

@Component({
  selector: 'app-pull-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pull-analysis.html',
  styleUrl: './pull-analysis.scss',
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class PullAnalysis {
  protected readonly store = inject(ReportStore);
  protected readonly format = formatOffset;
  protected readonly scope = signal<AnalysisScope>('pull');
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());

  constructor() {
    // Lazily pull damage (and, for the all-pulls tab, cast/death) events.
    effect(() => {
      const fights = this.scopeFights();
      const scope = this.scope();
      untracked(() => {
        for (const fight of fights) {
          void this.store.ensureDamage(fight.id);
          if (scope === 'all') {
            void this.store.ensureEvents(fight.id);
          }
        }
      });
    });
  }

  protected readonly scopeFights = computed<ReportFight[]>(() => {
    if (this.scope() === 'all') {
      return this.store.includedPulls();
    }
    const pull = this.store.selectedPull();
    return pull ? [pull] : [];
  });

  protected readonly ready = computed(() => {
    const damage = this.store.damageByFight();
    const events = this.store.events();
    const needEvents = this.scope() === 'all';
    return this.scopeFights().every((f) => damage.has(f.id) && (!needEvents || events.has(f.id)));
  });

  protected readonly title = computed(() => {
    if (this.scope() === 'all') {
      return `Encounter analysis — ${this.scopeFights().length} pulls`;
    }
    const pull = this.store.selectedPull();
    const pulls = this.store.selectedEncounter()?.pulls ?? [];
    const index = pull ? pulls.findIndex((p) => p.id === pull.id) + 1 : 0;
    return `Pull ${index} analysis`;
  });

  /** Wipefest-style mechanic table from damage-taken events. */
  protected readonly mechanics = computed<MechanicRow[]>(() => {
    const report = this.store.report();
    if (!report) {
      return [];
    }
    const damage = this.store.damageByFight();
    const players = new Map(this.store.players().map((p) => [p.id, p]));

    interface Agg {
      hits: number;
      total: number;
      byPlayer: Map<number, { damage: number; hits: number }>;
    }
    const byAbility = new Map<number, Agg>();

    for (const fight of this.scopeFights()) {
      for (const event of damage.get(fight.id) ?? []) {
        if (event.abilityGameID <= 1 || !players.has(event.targetID)) {
          continue;
        }
        const amount = event.amount + (event.absorbed ?? 0);
        let agg = byAbility.get(event.abilityGameID);
        if (!agg) {
          agg = { hits: 0, total: 0, byPlayer: new Map() };
          byAbility.set(event.abilityGameID, agg);
        }
        agg.hits++;
        agg.total += amount;
        const p = agg.byPlayer.get(event.targetID) ?? { damage: 0, hits: 0 };
        p.damage += amount;
        p.hits++;
        agg.byPlayer.set(event.targetID, p);
      }
    }

    return [...byAbility.entries()]
      .map(([id, agg]) => {
        const ability = report.abilities.get(id);
        const perPlayer = [...agg.byPlayer.entries()]
          .map(([playerId, stats]) => {
            const player = players.get(playerId);
            return {
              name: player?.name ?? `#${playerId}`,
              color: player ? classColor(player.className) : 'var(--text-1)',
              damage: stats.damage,
              hits: stats.hits,
              pct: 0,
            };
          })
          .sort((a, b) => b.damage - a.damage);
        const max = perPlayer[0]?.damage ?? 1;
        for (const row of perPlayer) {
          row.pct = Math.max(2, Math.round((row.damage / max) * 100));
        }
        return {
          id,
          name: ability?.name ?? `Ability #${id}`,
          icon: abilityIconUrl(ability?.icon),
          url: `https://www.wowhead.com/spell=${id}`,
          hits: agg.hits,
          playersHit: agg.byPlayer.size,
          totalDamage: agg.total,
          avgHit: Math.round(agg.total / agg.hits),
          perPlayer,
        };
      })
      .sort((a, b) => b.totalDamage - a.totalDamage);
  });

  protected readonly deathRows = computed<DeathRow[]>(() => {
    const pull = this.store.selectedPull();
    return pull ? this.buildDeathRows(pull) : [];
  });

  /** All-pulls tab: deaths per player, with how many had nothing pressed. */
  protected readonly deathLeaderboard = computed<LeaderboardRow[]>(() => {
    const rows = new Map<number, LeaderboardRow>();
    for (const fight of this.scopeFights()) {
      for (const death of this.buildDeathRows(fight)) {
        let row = rows.get(death.playerId);
        if (!row) {
          row = { name: death.playerName, color: death.playerColor, deaths: 0, unmitigated: 0 };
          rows.set(death.playerId, row);
        }
        row.deaths++;
        if (!death.mitigation) {
          row.unmitigated++;
        }
      }
    }
    return [...rows.values()].sort((a, b) => b.deaths - a.deaths || b.unmitigated - a.unmitigated);
  });

  protected readonly summary = computed<string[]>(() => {
    const pull = this.store.selectedPull();
    if (!pull || this.scope() !== 'pull') {
      return [];
    }
    const deaths = this.deathRows();
    const lines: string[] = [];
    const duration = formatOffset(pull.endTime - pull.startTime);

    if (pull.kill) {
      lines.push(`Kill after ${duration} with ${deaths.length} deaths. 🎉`);
    } else {
      const pct =
        pull.fightPercentage !== null ? ` — boss at ${Math.round(pull.fightPercentage)}%` : '';
      const phase = pull.lastPhase !== null ? ` (P${pull.lastPhase})` : '';
      lines.push(`Wiped at ${duration}${pct}${phase}.`);
    }

    if (deaths.length === 0) {
      lines.push('No deaths this pull.');
      return lines;
    }

    const first = deaths[0];
    const firstMitigation = first.mitigation
      ? `after using ${first.mitigation.name} ${first.mitigation.secondsBefore}s earlier`
      : 'with no defensive or health pot in the 12s before';
    lines.push(
      `First blood: ${first.playerName} at ${formatOffset(first.timeMs)} to ${first.abilityName}, ${firstMitigation}.`,
    );

    const killCounts = new Map<string, number>();
    for (const death of deaths) {
      killCounts.set(death.abilityName, (killCounts.get(death.abilityName) ?? 0) + 1);
    }
    const [topAbility, topCount] = [...killCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCount >= 2) {
      lines.push(`Deadliest mechanic: ${topAbility} (${topCount} deaths).`);
    }

    return lines;
  });

  protected close(): void {
    this.store.showAnalysis.set(false);
  }

  protected toggleExpanded(abilityId: number): void {
    const next = new Set(this.expanded());
    if (!next.delete(abilityId)) {
      next.add(abilityId);
    }
    this.expanded.set(next);
  }

  protected fmt(value: number): string {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}m`;
    }
    if (value >= 1_000) {
      return `${Math.round(value / 1_000)}k`;
    }
    return `${value}`;
  }

  protected onIconError(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }

  private buildDeathRows(fight: ReportFight): DeathRow[] {
    const report = this.store.report();
    const events = this.store.events().get(fight.id);
    if (!report || !events) {
      return [];
    }

    const players = new Map(this.store.players().map((p) => [p.id, p]));
    const actors = new Map(report.actors.map((a) => [a.id, a]));
    return [...events.deaths]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((death) => {
        const player = players.get(death.targetID);
        const abilityId = killingAbilityId(death);
        const killer = abilityId !== null ? report.abilities.get(abilityId) : null;
        const killerActor = death.killerID != null ? actors.get(death.killerID) : null;

        return {
          timeMs: death.timestamp - fight.startTime,
          playerId: death.targetID,
          playerName: player?.name ?? `#${death.targetID}`,
          playerColor: player ? classColor(player.className) : 'var(--text-1)',
          abilityName:
            killer?.name ?? (killerActor ? `${killerActor.name} (melee/unknown)` : 'Unknown'),
          abilityIcon: abilityIconUrl(killer?.icon),
          abilityUrl:
            abilityId !== null && abilityId > 1
              ? `https://www.wowhead.com/spell=${abilityId}`
              : null,
          mitigation: this.findMitigation(death, fight),
        };
      });
  }

  /** Last survival attempt by the dying player shortly before their death. */
  private findMitigation(death: DeathEvent, fight: ReportFight): DeathRow['mitigation'] {
    const report = this.store.report();
    const events = this.store.events().get(fight.id);
    if (!report || !events) {
      return null;
    }
    let mitigation: DeathRow['mitigation'] = null;
    for (const cast of events.friendlyCasts) {
      if (cast.sourceID !== death.targetID) {
        continue;
      }
      if (cast.timestamp > death.timestamp) {
        break;
      }
      if (death.timestamp - cast.timestamp > MITIGATION_WINDOW_MS) {
        continue;
      }
      const ability = report.abilities.get(cast.abilityGameID);
      const category = classifyAbility(cast.abilityGameID, ability?.name ?? null);
      if (category && MITIGATION_CATEGORIES.has(category)) {
        mitigation = {
          name: ability?.name ?? `#${cast.abilityGameID}`,
          icon: abilityIconUrl(ability?.icon),
          secondsBefore: Math.round((death.timestamp - cast.timestamp) / 1000),
        };
      }
    }
    return mitigation;
  }
}
