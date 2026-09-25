import { CastEvent, FightEvents, ReportAbility, ReportActor } from '../models/wcl';
import { buildRaidCooldowns, pullsWithoutLust } from './raid-cooldowns';
import { START, abilities, actors, makeFight, players, pullEvents } from './testing/fixture';
import { AnalysisInput } from './types';

const BLOODLUST = 2825;
const PRIMAL_RAGE = 264667;
const DRUMS = 381301;
const REBIRTH = 20484;
const FIREBALL = 133;
const PET_ID = 50;

/** The fixture roster plus the shaman's pet, for the pet-attribution case. */
const withPet: ReportActor[] = [
  ...actors,
  { id: PET_ID, name: 'Bloodpaw', type: 'Pet', subType: 'Hunter', petOwner: 3 },
];

const names = new Map<number, ReportAbility>([
  ...abilities,
  ...(
    [
      [BLOODLUST, 'Bloodlust'],
      [PRIMAL_RAGE, 'Primal Rage'],
      [DRUMS, 'Feral Hide Drums'],
      [REBIRTH, 'Rebirth'],
      [FIREBALL, 'Fireball'],
    ] as const
  ).map(
    ([id, name]) =>
      [id, { gameID: id, name, icon: `${name}.jpg`, type: null }] as [number, ReportAbility],
  ),
]);

function input(casts: CastEvent[], over: Partial<AnalysisInput> = {}): AnalysisInput {
  const fight = makeFight();
  const events: FightEvents = { friendlyCasts: casts, enemyCasts: [], deaths: [] };
  return {
    fights: [fight],
    players,
    abilities: names,
    actors: withPet,
    events: new Map([[fight.id, events]]),
    damage: new Map(),
    dispels: new Map(),
    ignoreAfterDeaths: null,
    ...over,
  };
}

describe('buildRaidCooldowns', () => {
  const { cast } = pullEvents(START);

  it('finds the haste buff and ignores rotational casts', () => {
    const result = buildRaidCooldowns(input([cast(5_000, 2, BLOODLUST), cast(6_000, 4, FIREBALL)]));

    expect(result.lust).toHaveLength(1);
    expect(result.lust[0].abilityName).toBe('Bloodlust');
    expect(result.lust[0].casterName).toBe('Healy');
  });

  it('credits a cast by a pet to its owner, not to the pet', () => {
    const petCast: CastEvent = {
      timestamp: START + 5_000,
      type: 'cast',
      sourceID: PET_ID,
      targetID: null,
      abilityGameID: PRIMAL_RAGE,
    };

    const result = buildRaidCooldowns(input([petCast]));

    // Dee owns the pet; without this the raid's lust reads as "Bloodpaw".
    expect(result.lust[0].casterName).toBe('Dee');
    expect(result.lust[0].viaPet).toBe('Bloodpaw');
  });

  it('counts drums, which are an item rather than a class ability', () => {
    const result = buildRaidCooldowns(input([cast(5_000, 1, DRUMS)]));

    expect(result.lust).toHaveLength(1);
    expect(result.lust[0].casterName).toBe('Tanky');
  });

  it('matches by name when the spell id is unknown to the catalog', () => {
    const unknownId = 999_111;
    const unknown = new Map(names).set(unknownId, {
      gameID: unknownId,
      name: 'Drums of the Next Expansion',
      icon: 'drum.jpg',
      type: null,
    });

    const result = buildRaidCooldowns(input([cast(5_000, 1, unknownId)], { abilities: unknown }));

    expect(result.lust).toHaveLength(1);
  });

  it('records a battle rez with who was picked up', () => {
    const rez: CastEvent = {
      timestamp: START + 30_000,
      type: 'cast',
      sourceID: 3,
      targetID: 1,
      abilityGameID: REBIRTH,
    };

    const result = buildRaidCooldowns(input([rez]));

    expect(result.battleRez).toHaveLength(1);
    expect(result.battleRez[0].casterName).toBe('Dee');
    expect(result.battleRez[0].targetName).toBe('Tanky');
    expect(result.byCaster).toEqual([{ name: 'Dee', color: expect.any(String), count: 1 }]);
  });

  it('keeps lust and rezzes apart', () => {
    const result = buildRaidCooldowns(
      input([cast(5_000, 2, BLOODLUST), { ...cast(9_000, 3, REBIRTH), targetID: 1 }]),
    );

    expect(result.lust).toHaveLength(1);
    expect(result.battleRez).toHaveLength(1);
  });

  it('respects the "ignore after N deaths" cutoff', () => {
    const fight = makeFight();
    const { death } = pullEvents(START);
    const events: FightEvents = {
      friendlyCasts: [cast(90_000, 2, BLOODLUST)],
      enemyCasts: [],
      deaths: [death(10_000, 1, 500002)],
    };

    const result = buildRaidCooldowns({
      ...input([]),
      fights: [fight],
      events: new Map([[fight.id, events]]),
      ignoreAfterDeaths: 1,
    });

    expect(result.lust).toHaveLength(0);
  });
});

describe('pullsWithoutLust', () => {
  it('names the pulls that never got one', () => {
    const a = makeFight({ id: 1 });
    const b = makeFight({ id: 2 });
    const used = buildRaidCooldowns(input([pullEvents(START).cast(5_000, 2, BLOODLUST)])).lust;

    expect(pullsWithoutLust([a, b], used)).toEqual([2]);
  });
});
