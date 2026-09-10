import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { classifyAbility } from '../../core/data/ability-catalog';
import { abilityIconUrl, classColor } from '../../core/data/wow';
import { formatOffset, killingAbilityId } from '../../core/models/wcl';
import { ReportStore } from '../../core/state/report-store';

/** Categories that count as "tried to survive" right before a death. */
const MITIGATION_CATEGORIES = new Set(['defensive', 'immunity', 'health-pot', 'healing-cd']);
const MITIGATION_WINDOW_MS = 12_000;

interface DeathRow {
  timeMs: number;
  playerName: string;
  playerColor: string;
  abilityName: string;
  abilityIcon: string;
  mitigation: { name: string; icon: string; secondsBefore: number } | null;
}

@Component({
  selector: 'app-pull-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel">
      <h3>📋 {{ title() }}</h3>
      <ul class="summary">
        @for (line of summary(); track $index) {
          <li>{{ line }}</li>
        }
      </ul>

      @if (deathRows().length > 0) {
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Player</th>
              <th>Killed by</th>
              <th>Last defensive / health pot before death</th>
            </tr>
          </thead>
          <tbody>
            @for (death of deathRows(); track $index) {
              <tr>
                <td class="time">{{ format(death.timeMs) }}</td>
                <td>
                  <span class="name" [style.color]="death.playerColor">{{ death.playerName }}</span>
                </td>
                <td>
                  <img [src]="death.abilityIcon" (error)="onIconError($event)" alt="" />
                  {{ death.abilityName }}
                </td>
                <td>
                  @if (death.mitigation; as m) {
                    <img [src]="m.icon" (error)="onIconError($event)" alt="" />
                    {{ m.name }} <span class="ago">{{ m.secondsBefore }}s before</span>
                  } @else {
                    <span class="none">— nothing pressed</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styles: `
    .panel {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--bg-1);
      padding: 12px 16px;
      max-height: 300px;
      overflow-y: auto;
    }

    h3 {
      margin: 0 0 8px;
      font-size: 13px;
    }

    .summary {
      margin: 0 0 10px;
      padding-left: 18px;
      color: var(--text-1);
      font-size: 13px;

      li {
        margin-bottom: 2px;
      }
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }

    th {
      text-align: left;
      color: var(--text-2);
      font-weight: 500;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 4px 10px 4px 0;
      border-bottom: 1px solid var(--border);
    }

    td {
      padding: 4px 10px 4px 0;
      border-bottom: 1px solid rgba(51, 51, 62, 0.5);
      vertical-align: middle;

      img {
        width: 16px;
        height: 16px;
        border-radius: 3px;
        vertical-align: -3px;
        margin-right: 4px;
      }
    }

    .time {
      font-variant-numeric: tabular-nums;
      color: var(--text-2);
    }

    .name {
      font-weight: 600;
    }

    .ago {
      color: var(--text-2);
      font-size: 11px;
    }

    .none {
      color: var(--danger);
    }
  `,
})
export class PullAnalysis {
  protected readonly store = inject(ReportStore);
  protected readonly format = formatOffset;

  protected readonly title = computed(() => {
    const pull = this.store.selectedPull();
    const pulls = this.store.selectedEncounter()?.pulls ?? [];
    const index = pull ? pulls.findIndex((p) => p.id === pull.id) + 1 : 0;
    return `Pull ${index} analysis`;
  });

  protected readonly deathRows = computed<DeathRow[]>(() => {
    const report = this.store.report();
    const pull = this.store.selectedPull();
    const events = pull ? this.store.events().get(pull.id) : null;
    if (!report || !pull || !events) {
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

        // Last survival attempt by this player shortly before dying.
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

        return {
          timeMs: death.timestamp - pull.startTime,
          playerName: player?.name ?? `#${death.targetID}`,
          playerColor: player ? classColor(player.className) : 'var(--text-1)',
          abilityName:
            killer?.name ?? (killerActor ? `${killerActor.name} (melee/unknown)` : 'Unknown'),
          abilityIcon: abilityIconUrl(killer?.icon),
          mitigation,
        };
      });
  });

  protected readonly summary = computed<string[]>(() => {
    const pull = this.store.selectedPull();
    if (!pull) {
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

  protected onIconError(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }
}
