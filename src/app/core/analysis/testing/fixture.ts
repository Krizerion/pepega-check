import {
  CastEvent,
  DamageEvent,
  DeathEvent,
  PlayerInfo,
  ReportAbility,
  ReportActor,
  ReportFight,
} from '../../models/wcl';

/**
 * A four-raider test raid and event builders, shared by the analysis specs.
 *
 * Fights, casts and damage stay in the individual specs: each feature needs its
 * own timeline, and a fixture that tries to serve all of them stops being
 * readable.
 */

export const BOSS_ID = 100;
export const ENV_ID = -1;

/** Spell ids used by the fixtures; the survival ones exist in the catalog. */
export const SHIELD_WALL = 871; // defensive, 240s cooldown
export const BARKSKIN = 22812; // defensive, 60s cooldown
export const HEALTHSTONE = 6262; // health-pot
export const TEMPERED_POTION = 431932; // combat-pot
export const SPIRIT_LINK = 98008; // raid-cd
export const FEL_ARMOR = 900900; // player self-damage, not a mechanic
export const RAID_WIDE = 500001;
export const SPIKE = 500002;
export const TANKBUSTER = 500003;
export const CLEANSE = 527;

export const players: PlayerInfo[] = [
  { id: 1, name: 'Tanky', className: 'Warrior', spec: 'Protection', role: 'tank' },
  { id: 2, name: 'Healy', className: 'Shaman', spec: 'Restoration', role: 'healer' },
  { id: 3, name: 'Dee', className: 'Druid', spec: 'Balance', role: 'dps' },
  { id: 4, name: 'Eee', className: 'Mage', spec: 'Frost', role: 'dps' },
];

export const actors: ReportActor[] = [
  { id: BOSS_ID, name: 'Test Boss', type: 'NPC', subType: 'Boss', petOwner: null },
  { id: ENV_ID, name: 'Environment', type: 'NPC', subType: 'NPC', petOwner: null },
  ...players.map((p) => ({
    id: p.id,
    name: p.name,
    type: 'Player',
    subType: p.className,
    petOwner: null,
  })),
];

export const abilities = new Map<number, ReportAbility>(
  (
    [
      [SHIELD_WALL, 'Shield Wall'],
      [BARKSKIN, 'Barkskin'],
      [HEALTHSTONE, 'Healthstone'],
      [TEMPERED_POTION, 'Tempered Potion'],
      [SPIRIT_LINK, 'Spirit Link Totem'],
      [FEL_ARMOR, 'Fel Armor'],
      [RAID_WIDE, 'Raid Wide Nuke'],
      [SPIKE, 'Floor Spike'],
      [TANKBUSTER, 'Big Smack'],
      [CLEANSE, 'Purify'],
    ] as const
  ).map(([id, name]) => [id, { gameID: id, name, icon: `${name}.jpg`, type: null }]),
);

export const START = 1_000_000;

/** Event builders whose offsets are relative to one pull's start. */
export function pullEvents(start: number) {
  return {
    cast: (at: number, sourceID: number, abilityGameID: number): CastEvent => ({
      timestamp: start + at,
      type: 'cast',
      sourceID,
      targetID: BOSS_ID,
      abilityGameID,
    }),

    hit: (
      at: number,
      targetID: number,
      abilityGameID: number,
      amount: number,
      extra: Partial<DamageEvent> = {},
    ): DamageEvent => ({
      timestamp: start + at,
      sourceID: BOSS_ID,
      targetID,
      abilityGameID,
      amount,
      ...extra,
    }),

    death: (at: number, targetID: number, abilityGameID: number): DeathEvent => ({
      timestamp: start + at,
      targetID,
      abilityGameID,
      killingAbilityGameID: abilityGameID,
      killerID: BOSS_ID,
    }),
  };
}

/** A two-phase pull, with the second phase starting 100s in. */
export function makeFight(over: Partial<ReportFight> = {}): ReportFight {
  const start = over.startTime ?? START;
  return {
    id: 1,
    name: 'Test Boss',
    encounterID: 1,
    difficulty: 5,
    kill: false,
    startTime: start,
    endTime: start + 300_000,
    fightPercentage: 20,
    lastPhase: 2,
    size: players.length,
    phaseTransitions: [
      { id: 1, startTime: start },
      { id: 2, startTime: start + 100_000 },
    ],
    ...over,
  };
}
