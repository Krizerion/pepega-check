import { classifyAbility } from '../data/ability-catalog';
import { classColor } from '../data/wow';
import { deathCutoff, isAfterCutoff } from './cutoff';
import { AnalysisInput, UtilityRow } from './types';

const ROLE_ORDER: Record<string, number> = { tank: 0, healer: 1, dps: 2 };

type Counts = Omit<UtilityRow, 'name' | 'color'>;

const blank = (): Counts => ({
  defensives: 0,
  raidCds: 0,
  combatPots: 0,
  healthPots: 0,
  dispels: 0,
  deaths: 0,
});

/** Per-raider survival and utility activity across the scope, cutoff-aware. */
export function buildUtilityRows(input: AnalysisInput): UtilityRow[] {
  const counts = new Map<number, Counts>();
  const rowFor = (id: number) => {
    const existing = counts.get(id);
    if (existing) {
      return existing;
    }
    const created = blank();
    counts.set(id, created);
    return created;
  };

  for (const fight of input.fights) {
    const cutoff = deathCutoff(fight, input.events, input.ignoreAfterDeaths);
    const fightEvents = input.events.get(fight.id);

    for (const cast of fightEvents?.friendlyCasts ?? []) {
      if (isAfterCutoff(cast.timestamp, cutoff)) {
        continue;
      }
      const ability = input.abilities.get(cast.abilityGameID);
      const category = classifyAbility(cast.abilityGameID, ability?.name ?? null);
      if (!category) {
        continue;
      }
      const row = rowFor(cast.sourceID);
      switch (category) {
        case 'defensive':
        case 'immunity':
          row.defensives++;
          break;
        case 'raid-cd':
          row.raidCds++;
          break;
        case 'combat-pot':
          row.combatPots++;
          break;
        case 'health-pot':
          row.healthPots++;
          break;
      }
    }

    // Successful dispels only — failed dispel casts never produce these events.
    for (const dispel of input.dispels.get(fight.id) ?? []) {
      if (isAfterCutoff(dispel.timestamp, cutoff)) {
        continue;
      }
      rowFor(dispel.sourceID).dispels++;
    }

    for (const death of fightEvents?.deaths ?? []) {
      if (isAfterCutoff(death.timestamp, cutoff)) {
        continue;
      }
      rowFor(death.targetID).deaths++;
    }
  }

  return [...input.players]
    .sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) || a.name.localeCompare(b.name),
    )
    .map((player) => ({
      name: player.name,
      color: classColor(player.className),
      ...(counts.get(player.id) ?? blank()),
    }));
}
