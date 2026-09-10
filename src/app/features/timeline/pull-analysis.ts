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
import {
  DeathEvent,
  ReportFight,
  fightDuration,
  formatOffset,
  killingAbilityId,
} from '../../core/models/wcl';
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
  /** Unique per phase + ability, used for expansion state. */
  key: string;
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

interface PhaseGroup {
  phase: number;
  /** null = single unlabelled group (fight has no phases). */
  label: string | null;
  mechanics: MechanicRow[];
}

interface LeaderboardRow {
  name: string;
  color: string;
  deaths: number;
  unmitigated: number;
}

interface ConsumableRow {
  name: string;
  color: string;
  combatPots: number;
  healthPots: number;
}

interface PerformanceRow {
  name: string;
  color: string;
  damage: number;
  dps: number;
  healing: number;
  hps: number;
  /** WCL rank percentile (kills only); null when no kill is in scope. */
  parse: number | null;
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
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly deathOptions = [1, 2, 3, 4, 5, 8, 10];

  constructor() {
    // Lazily pull damage (and, for the all-pulls tab, cast/death) events.
    effect(() => {
      const fights = this.scopeFights();
      const scope = this.scope();
      untracked(() => {
        for (const fight of fights) {
          void this.store.ensureDamage(fight.id);
          void this.store.ensurePerformance(fight.id);
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

  /** Wipefest-style mechanic tables from damage-taken events, grouped by phase. */
  protected readonly mechanicGroups = computed<PhaseGroup[]>(() => {
    const report = this.store.report();
    if (!report) {
      return [];
    }
    const damage = this.store.damageByFight();
    const players = new Map(this.store.players().map((p) => [p.id, p]));
    // Only true enemy mechanics: damage sourced by NPCs, not player self-damage
    // (Fel Armor, Burning Rush, trinkets…) or environment effects.
    const npcSources = new Set(
      report.actors.filter((a) => a.type === 'NPC' && a.name !== 'Environment').map((a) => a.id),
    );

    interface Agg {
      hits: number;
      total: number;
      byPlayer: Map<number, { damage: number; hits: number }>;
    }
    const byPhase = new Map<number, Map<number, Agg>>();
    let sawTransitions = false;

    for (const fight of this.scopeFights()) {
      const cutoff = this.cutoffFor(fight);
      const transitions = (fight.phaseTransitions ?? [])
        .slice()
        .sort((a, b) => a.startTime - b.startTime);
      if (transitions.length > 1) {
        sawTransitions = true;
      }
      const phaseOf = (timestamp: number): number => {
        let phase = 1;
        for (const t of transitions) {
          if (t.startTime <= timestamp) {
            phase = t.id;
          }
        }
        return phase;
      };

      for (const event of damage.get(fight.id) ?? []) {
        if (event.abilityGameID <= 1 || !players.has(event.targetID)) {
          continue;
        }
        if (event.sourceID === null || !npcSources.has(event.sourceID)) {
          continue;
        }
        if (cutoff !== null && event.timestamp > cutoff) {
          continue;
        }
        const phase = phaseOf(event.timestamp);
        let abilities = byPhase.get(phase);
        if (!abilities) {
          abilities = new Map();
          byPhase.set(phase, abilities);
        }
        const amount = event.amount + (event.absorbed ?? 0);
        let agg = abilities.get(event.abilityGameID);
        if (!agg) {
          agg = { hits: 0, total: 0, byPlayer: new Map() };
          abilities.set(event.abilityGameID, agg);
        }
        agg.hits++;
        agg.total += amount;
        const p = agg.byPlayer.get(event.targetID) ?? { damage: 0, hits: 0 };
        p.damage += amount;
        p.hits++;
        agg.byPlayer.set(event.targetID, p);
      }
    }

    const groups = [...byPhase.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([phase, abilities]) => ({
        phase,
        label: null as string | null,
        mechanics: [...abilities.entries()]
          .map(([id, agg]) => this.toMechanicRow(phase, id, agg, report, players))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
    if (groups.length > 1 || sawTransitions) {
      for (const group of groups) {
        group.label = `Phase ${group.phase}`;
      }
    }
    return groups;
  });

  private toMechanicRow(
    phase: number,
    id: number,
    agg: { hits: number; total: number; byPlayer: Map<number, { damage: number; hits: number }> },
    report: NonNullable<ReturnType<ReportStore['report']>>,
    players: Map<number, { name: string; className: string }>,
  ): MechanicRow {
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
      key: `${phase}:${id}`,
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
  }

  /** Overall damage/healing per raider across the scope, with kill parses. */
  protected readonly performance = computed<PerformanceRow[]>(() => {
    const perf = this.store.performanceByFight();
    const fights = this.scopeFights();
    const totalSeconds = Math.max(1, fights.reduce((sum, f) => sum + fightDuration(f), 0) / 1000);

    const totals = new Map<number, { damage: number; healing: number }>();
    const parseSums = new Map<string, { sum: number; count: number }>();
    let anyLoaded = false;

    for (const fight of fights) {
      const data = perf.get(fight.id);
      if (!data) {
        continue;
      }
      anyLoaded = true;
      for (const entry of data.entries) {
        const t = totals.get(entry.actorId) ?? { damage: 0, healing: 0 };
        t.damage += entry.damage;
        t.healing += entry.healing;
        totals.set(entry.actorId, t);
      }
      if (data.parses) {
        for (const [name, parse] of Object.entries(data.parses)) {
          const p = parseSums.get(name) ?? { sum: 0, count: 0 };
          p.sum += parse;
          p.count++;
          parseSums.set(name, p);
        }
      }
    }
    if (!anyLoaded) {
      return [];
    }

    return this.store
      .players()
      .map((player) => {
        const t = totals.get(player.id) ?? { damage: 0, healing: 0 };
        const p = parseSums.get(player.name);
        return {
          name: player.name,
          color: classColor(player.className),
          damage: t.damage,
          dps: t.damage / totalSeconds,
          healing: t.healing,
          hps: t.healing / totalSeconds,
          parse: p ? Math.round(p.sum / p.count) : null,
        };
      })
      .sort((a, b) => b.damage - a.damage);
  });

  protected readonly hasParses = computed(() => this.performance().some((r) => r.parse !== null));

  /** WCL-style parse colors. */
  protected parseColor(parse: number): string {
    if (parse >= 100) return '#e5cc80';
    if (parse >= 99) return '#e268a8';
    if (parse >= 95) return '#ff8000';
    if (parse >= 75) return '#a335ee';
    if (parse >= 50) return '#0070dd';
    if (parse >= 25) return '#1eff00';
    return '#8b8b98';
  }

  /** Combat pot and health pot/stone usage per raider, cutoff-aware. */
  protected readonly consumables = computed<ConsumableRow[]>(() => {
    const report = this.store.report();
    if (!report) {
      return [];
    }
    const events = this.store.events();
    const counts = new Map<number, { combatPots: number; healthPots: number }>();

    for (const fight of this.scopeFights()) {
      const cutoff = this.cutoffFor(fight);
      for (const cast of events.get(fight.id)?.friendlyCasts ?? []) {
        if (cutoff !== null && cast.timestamp > cutoff) {
          continue;
        }
        const ability = report.abilities.get(cast.abilityGameID);
        const category = classifyAbility(cast.abilityGameID, ability?.name ?? null);
        if (category !== 'combat-pot' && category !== 'health-pot') {
          continue;
        }
        const row = counts.get(cast.sourceID) ?? { combatPots: 0, healthPots: 0 };
        if (category === 'combat-pot') {
          row.combatPots++;
        } else {
          row.healthPots++;
        }
        counts.set(cast.sourceID, row);
      }
    }

    const roleOrder: Record<string, number> = { tank: 0, healer: 1, dps: 2 };
    return this.store
      .players()
      .slice()
      .sort(
        (a, b) =>
          (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3) || a.name.localeCompare(b.name),
      )
      .map((player) => ({
        name: player.name,
        color: classColor(player.className),
        combatPots: counts.get(player.id)?.combatPots ?? 0,
        healthPots: counts.get(player.id)?.healthPots ?? 0,
      }));
  });

  /** Absolute timestamp of the Nth death in a fight, per the ignore-after setting. */
  private cutoffFor(fight: ReportFight): number | null {
    const n = this.store.ignoreAfterDeaths();
    if (n === null) {
      return null;
    }
    const deaths = this.store.events().get(fight.id)?.deaths;
    if (!deaths || deaths.length < n) {
      return null;
    }
    const sorted = [...deaths].sort((a, b) => a.timestamp - b.timestamp);
    return sorted[n - 1].timestamp;
  }

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

  protected toggleExpanded(key: string): void {
    const next = new Set(this.expanded());
    if (!next.delete(key)) {
      next.add(key);
    }
    this.expanded.set(next);
  }

  protected asSelect(event: Event): HTMLSelectElement {
    return event.target as HTMLSelectElement;
  }

  protected setIgnoreDeaths(value: string): void {
    this.store.ignoreAfterDeaths.set(value === '' ? null : Number(value));
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

    const cutoff = this.cutoffFor(fight);
    const players = new Map(this.store.players().map((p) => [p.id, p]));
    const actors = new Map(report.actors.map((a) => [a.id, a]));
    return [...events.deaths]
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((death) => cutoff === null || death.timestamp <= cutoff)
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
