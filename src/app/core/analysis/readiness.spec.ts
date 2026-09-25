import { CombatantAura, CombatantInfoEvent, ReportAbility } from '../models/wcl';
import { buildReadiness } from './readiness';
import { abilities, makeFight, players } from './testing/fixture';

const INTELLECT = 1459; // Mage
const FORTITUDE = 21562; // Priest — nobody in the fixture roster is one
const BATTLE_SHOUT = 6673; // Warrior
const MARK = 1126; // Druid
const SKYFURY = 462854; // Shaman

const FLASK = 431972;
const FOOD = 461957;
const RUNE = 453250;

const auraNames = new Map<number, ReportAbility>([
  ...abilities,
  ...(
    [
      [FLASK, 'Flask of Alchemical Chaos'],
      [FOOD, 'Well Fed'],
      [RUNE, 'Crystallized Augment Rune'],
    ] as const
  ).map(
    ([id, name]) =>
      [id, { gameID: id, name, icon: `${name}.jpg`, type: null }] as [number, ReportAbility],
  ),
]);

const input = { players, abilities: auraNames };

/** Everything a well-prepared raider carries, minus the Priest buff nobody brings. */
const FULL = [INTELLECT, BATTLE_SHOUT, MARK, SKYFURY, FLASK, FOOD, RUNE];

function info(sourceID: number, abilityIds: number[], names?: Map<number, string>) {
  const auras: CombatantAura[] = abilityIds.map((ability) => ({
    ability,
    name: names?.get(ability) ?? auraNames.get(ability)?.name ?? null,
    source: sourceID,
    stacks: 1,
  }));
  return { timestamp: 0, sourceID, auras } satisfies CombatantInfoEvent;
}

/** The whole fixture roster, fully buffed, as a starting point. */
function allReady(): CombatantInfoEvent[] {
  return players.map((p) => info(p.id, FULL));
}

describe('buildReadiness', () => {
  const fight = makeFight();

  it('flags a raider who brought no flask', () => {
    const snapshots = allReady();
    snapshots[2] = info(
      players[2].id,
      FULL.filter((id) => id !== FLASK),
    );

    const result = buildReadiness(fight, input, snapshots);
    const dee = result.rows.find((r) => r.name === 'Dee');

    expect(dee?.flask).toBeNull();
    expect(result.counts.flask).toBe(3);
    expect(result.counts.total).toBe(4);
  });

  it('matches consumables by name, so a new patch still counts', () => {
    const newFlaskId = 999_001;
    const snapshots = players.map((p) =>
      info(
        p.id,
        [...FULL.filter((id) => id !== FLASK), newFlaskId],
        new Map([[newFlaskId, 'Flask of Some Future Expansion']]),
      ),
    );

    const result = buildReadiness(fight, input, snapshots);

    expect(result.counts.flask).toBe(4);
  });

  it('lists roster members who were not in the pull', () => {
    const snapshots = allReady().filter((s) => s.sourceID !== players[1].id);

    const result = buildReadiness(fight, input, snapshots);

    expect(result.absent.map((a) => a.name)).toEqual(['Healy']);
    // Absent raiders are not also reported as unprepared.
    expect(result.rows.map((r) => r.name)).not.toContain('Healy');
  });

  it('reports a buff nobody had once, not against every raider', () => {
    const result = buildReadiness(fight, input, allReady());

    // No Priest in the fixture roster, so Fortitude is a raid-wide gap.
    expect(result.raidWideGaps.map((b) => b.id)).toContain(FORTITUDE);
    expect(result.rows.every((r) => r.missingBuffs.length === 0)).toBe(true);
  });

  it('says when nobody in the raid could have brought it', () => {
    const result = buildReadiness(fight, input, allReady());
    const gap = result.raidWideGaps.find((b) => b.id === FORTITUDE);

    expect(gap?.nobodyBrings).toBe(true);
  });

  it('blames the individual when others had the buff', () => {
    const snapshots = allReady();
    snapshots[0] = info(
      players[0].id,
      FULL.filter((id) => id !== MARK),
    );

    const result = buildReadiness(fight, input, snapshots);

    // A Druid is present and everyone else has it, so this one is on Tanky.
    expect(result.raidWideGaps.map((b) => b.id)).not.toContain(MARK);
    expect(result.rows.find((r) => r.name === 'Tanky')?.missingBuffs.map((b) => b.id)).toEqual([
      MARK,
    ]);
  });

  it('puts the worst-prepared raider first', () => {
    const snapshots = allReady();
    snapshots[3] = info(players[3].id, [INTELLECT]);

    const result = buildReadiness(fight, input, snapshots);

    expect(result.rows[0].name).toBe('Eee');
  });

  it('copes with a snapshot that carries no auras at all', () => {
    const snapshots: CombatantInfoEvent[] = players.map((p) => ({
      timestamp: 0,
      sourceID: p.id,
      auras: null,
    }));

    const result = buildReadiness(fight, input, snapshots);

    expect(result.counts.flask).toBe(0);
    expect(result.rows).toHaveLength(4);
    expect(result.absent).toHaveLength(0);
  });
});
