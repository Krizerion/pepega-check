import {
  CastEvent,
  DeathEvent,
  FightEvents,
  PlayerInfo,
  PlayerRole,
  Report,
  ReportAbility,
  ReportFight,
} from '../models/wcl';

/**
 * Deterministic sample data (a night of pulls on a fictional boss) used by
 * "demo mode" so the UI can be explored without Warcraft Logs credentials.
 */

export const DEMO_REPORT_CODE = 'DEMO';

interface DemoSpell {
  id: number;
  name: string;
  icon: string;
  /** Cooldown in seconds; drives how often the demo raider presses it. */
  cooldown: number;
  /** Classes that use it, or 'all'. */
  classes: string[] | 'all';
}

const PLAYER_SPELLS: DemoSpell[] = [
  {
    id: 871,
    name: 'Shield Wall',
    icon: 'ability_warrior_shieldwall.jpg',
    cooldown: 180,
    classes: ['Warrior'],
  },
  {
    id: 12975,
    name: 'Last Stand',
    icon: 'spell_holy_ashestoashes.jpg',
    cooldown: 180,
    classes: ['Warrior'],
  },
  {
    id: 107574,
    name: 'Avatar',
    icon: 'warrior_talent_icon_avatar.jpg',
    cooldown: 90,
    classes: ['Warrior'],
  },
  {
    id: 48792,
    name: 'Icebound Fortitude',
    icon: 'spell_deathknight_iceboundfortitude.jpg',
    cooldown: 120,
    classes: ['DeathKnight'],
  },
  {
    id: 48707,
    name: 'Anti-Magic Shell',
    icon: 'spell_shadow_antimagicshell.jpg',
    cooldown: 60,
    classes: ['DeathKnight'],
  },
  {
    id: 275699,
    name: 'Apocalypse',
    icon: 'artifactability_unholydeathknight_deathsembrace.jpg',
    cooldown: 90,
    classes: ['DeathKnight'],
  },
  {
    id: 108271,
    name: 'Astral Shift',
    icon: 'ability_shaman_astralshift.jpg',
    cooldown: 90,
    classes: ['Shaman'],
  },
  {
    id: 98008,
    name: 'Spirit Link Totem',
    icon: 'spell_shaman_spiritlink.jpg',
    cooldown: 180,
    classes: ['Shaman'],
  },
  {
    id: 108280,
    name: 'Healing Tide Totem',
    icon: 'ability_shaman_healingtide.jpg',
    cooldown: 180,
    classes: ['Shaman'],
  },
  {
    id: 114052,
    name: 'Ascendance',
    icon: 'spell_fire_elementaldevastation.jpg',
    cooldown: 180,
    classes: ['Shaman'],
  },
  {
    id: 22812,
    name: 'Barkskin',
    icon: 'spell_nature_stoneclawtotem.jpg',
    cooldown: 60,
    classes: ['Druid'],
  },
  {
    id: 740,
    name: 'Tranquility',
    icon: 'spell_nature_tranquility.jpg',
    cooldown: 180,
    classes: ['Druid'],
  },
  {
    id: 391528,
    name: 'Convoke the Spirits',
    icon: 'ability_ardenweald_druid.jpg',
    cooldown: 120,
    classes: ['Druid'],
  },
  { id: 45438, name: 'Ice Block', icon: 'spell_frost_frost.jpg', cooldown: 240, classes: ['Mage'] },
  {
    id: 190319,
    name: 'Combustion',
    icon: 'spell_fire_sealoffire.jpg',
    cooldown: 120,
    classes: ['Mage'],
  },
  {
    id: 235313,
    name: 'Blazing Barrier',
    icon: 'ability_mage_moltenarmor.jpg',
    cooldown: 25,
    classes: ['Mage'],
  },
  {
    id: 104773,
    name: 'Unending Resolve',
    icon: 'spell_shadow_demonictactics.jpg',
    cooldown: 180,
    classes: ['Warlock'],
  },
  {
    id: 1122,
    name: 'Summon Infernal',
    icon: 'spell_shadow_summoninfernal.jpg',
    cooldown: 180,
    classes: ['Warlock'],
  },
  {
    id: 31224,
    name: 'Cloak of Shadows',
    icon: 'spell_shadow_nethercloak.jpg',
    cooldown: 120,
    classes: ['Rogue'],
  },
  { id: 1966, name: 'Feint', icon: 'ability_rogue_feint.jpg', cooldown: 15, classes: ['Rogue'] },
  {
    id: 13750,
    name: 'Adrenaline Rush',
    icon: 'spell_shadow_shadowworddominate.jpg',
    cooldown: 180,
    classes: ['Rogue'],
  },
  {
    id: 186265,
    name: 'Aspect of the Turtle',
    icon: 'ability_hunter_pet_turtle.jpg',
    cooldown: 180,
    classes: ['Hunter'],
  },
  {
    id: 19574,
    name: 'Bestial Wrath',
    icon: 'ability_druid_ferociousbite.jpg',
    cooldown: 90,
    classes: ['Hunter'],
  },
  {
    id: 47585,
    name: 'Dispersion',
    icon: 'spell_shadow_dispersion.jpg',
    cooldown: 120,
    classes: ['Priest'],
  },
  {
    id: 62618,
    name: 'Power Word: Barrier',
    icon: 'spell_holy_powerwordbarrier.jpg',
    cooldown: 180,
    classes: ['Priest'],
  },
  {
    id: 10060,
    name: 'Power Infusion',
    icon: 'spell_holy_powerinfusion.jpg',
    cooldown: 120,
    classes: ['Priest'],
  },
  {
    id: 64843,
    name: 'Divine Hymn',
    icon: 'spell_holy_divinehymn.jpg',
    cooldown: 180,
    classes: ['Priest'],
  },
  {
    id: 642,
    name: 'Divine Shield',
    icon: 'spell_holy_divineshield.jpg',
    cooldown: 300,
    classes: ['Paladin'],
  },
  {
    id: 31884,
    name: 'Avenging Wrath',
    icon: 'spell_holy_avenginewrath.jpg',
    cooldown: 120,
    classes: ['Paladin'],
  },
  {
    id: 633,
    name: 'Lay on Hands',
    icon: 'spell_holy_layonhands.jpg',
    cooldown: 420,
    classes: ['Paladin'],
  },
  {
    id: 115203,
    name: 'Fortifying Brew',
    icon: 'ability_monk_fortifyingale_new.jpg',
    cooldown: 240,
    classes: ['Monk'],
  },
  {
    id: 123904,
    name: 'Invoke Xuen',
    icon: 'ability_monk_summontigerstatue.jpg',
    cooldown: 120,
    classes: ['Monk'],
  },
  {
    id: 198589,
    name: 'Blur',
    icon: 'ability_demonhunter_blur.jpg',
    cooldown: 60,
    classes: ['DemonHunter'],
  },
  {
    id: 191427,
    name: 'Metamorphosis',
    icon: 'ability_demonhunter_metamorphasisdps.jpg',
    cooldown: 240,
    classes: ['DemonHunter'],
  },
  {
    id: 363916,
    name: 'Obsidian Scales',
    icon: 'inv_artifact_dragonscales.jpg',
    cooldown: 90,
    classes: ['Evoker'],
  },
  {
    id: 375087,
    name: 'Dragonrage',
    icon: 'ability_evoker_dragonrage.jpg',
    cooldown: 120,
    classes: ['Evoker'],
  },
  {
    id: 6262,
    name: 'Healthstone',
    icon: 'warlock_-healthstone.jpg',
    cooldown: 999,
    classes: 'all',
  },
  { id: 431932, name: 'Tempered Potion', icon: 'inv_flask_red.jpg', cooldown: 300, classes: 'all' },
];

const BOSS_SPELLS: (DemoSpell & { period: number; firstAt: number })[] = [
  {
    id: 900001,
    name: 'Necrotic Vapors',
    icon: 'spell_shadow_deathanddecay.jpg',
    cooldown: 0,
    classes: 'all',
    period: 60,
    firstAt: 8,
  },
  {
    id: 900002,
    name: 'Call of the Serpent',
    icon: 'spell_nature_guardianward.jpg',
    cooldown: 0,
    classes: 'all',
    period: 90,
    firstAt: 25,
  },
  {
    id: 900003,
    name: 'Spectral Coils',
    icon: 'spell_frost_chainsofice.jpg',
    cooldown: 0,
    classes: 'all',
    period: 45,
    firstAt: 40,
  },
  {
    id: 900004,
    name: 'Rage of the Shackled',
    icon: 'spell_shadow_unholyfrenzy.jpg',
    cooldown: 0,
    classes: 'all',
    period: 120,
    firstAt: 105,
  },
  {
    id: 900005,
    name: 'Venomous Heart',
    icon: 'ability_creature_poison_02.jpg',
    cooldown: 0,
    classes: 'all',
    period: 75,
    firstAt: 55,
  },
];

const ROSTER: { name: string; className: string; spec: string; role: PlayerRole }[] = [
  { name: 'Bagertatsuo', className: 'Warrior', spec: 'Protection', role: 'tank' },
  { name: 'Vengass', className: 'DemonHunter', spec: 'Vengeance', role: 'tank' },
  { name: 'Sherman', className: 'Shaman', spec: 'Restoration', role: 'healer' },
  { name: 'Feilina', className: 'Priest', spec: 'Discipline', role: 'healer' },
  { name: 'Maity', className: 'Druid', spec: 'Restoration', role: 'healer' },
  { name: 'Luxeona', className: 'Paladin', spec: 'Holy', role: 'healer' },
  { name: 'Azeryx', className: 'Hunter', spec: 'Marksmanship', role: 'dps' },
  { name: 'Nelfers', className: 'Druid', spec: 'Balance', role: 'dps' },
  { name: 'Dawon', className: 'Shaman', spec: 'Elemental', role: 'dps' },
  { name: 'Natureweaver', className: 'Evoker', spec: 'Devastation', role: 'dps' },
  { name: 'Zelyo', className: 'DeathKnight', spec: 'Unholy', role: 'dps' },
  { name: 'Krizerio', className: 'Monk', spec: 'Windwalker', role: 'dps' },
  { name: 'Miragè', className: 'Mage', spec: 'Fire', role: 'dps' },
  { name: 'Xpactt', className: 'Mage', spec: 'Frost', role: 'dps' },
  { name: 'Thatcrit', className: 'Warlock', spec: 'Demonology', role: 'dps' },
  { name: 'Vanzio', className: 'Rogue', spec: 'Assassination', role: 'dps' },
  { name: 'Valahan', className: 'Paladin', spec: 'Retribution', role: 'dps' },
  { name: 'Racor', className: 'Warrior', spec: 'Fury', role: 'dps' },
  { name: 'Simbi', className: 'Priest', spec: 'Shadow', role: 'dps' },
  { name: 'Stenli', className: 'DeathKnight', spec: 'Frost', role: 'dps' },
];

/** Pull durations (seconds) and best boss % for the demo night; last pull is the kill. */
const PULLS: { duration: number; bossPct: number; phase: number }[] = [
  { duration: 173, bossPct: 71, phase: 1 },
  { duration: 288, bossPct: 55, phase: 2 },
  { duration: 401, bossPct: 41, phase: 2 },
  { duration: 132, bossPct: 86, phase: 1 },
  { duration: 524, bossPct: 19, phase: 3 },
  { duration: 519, bossPct: 15, phase: 3 },
  { duration: 598, bossPct: 0, phase: 3 },
];

/** Small deterministic PRNG so the demo report is stable between loads. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoData {
  report: Report;
  players: PlayerInfo[];
  eventsByFight: Map<number, FightEvents>;
}

export function buildDemoReport(): DemoData {
  const random = mulberry32(0x5eed);
  const bossActorId = 100;
  const players: PlayerInfo[] = ROSTER.map((p, i) => ({
    id: i + 1,
    name: p.name,
    className: p.className,
    spec: p.spec,
    role: p.role,
  }));

  const abilities = new Map<number, ReportAbility>(
    [...PLAYER_SPELLS, ...BOSS_SPELLS].map((s) => [
      s.id,
      { gameID: s.id, name: s.name, icon: s.icon, type: null },
    ]),
  );

  const fights: ReportFight[] = [];
  const eventsByFight = new Map<number, FightEvents>();
  let clock = 10 * 60_000;

  PULLS.forEach((pull, index) => {
    const id = index + 1;
    const startTime = clock;
    const endTime = startTime + pull.duration * 1000;
    clock = endTime + (120 + Math.floor(random() * 300)) * 1000;

    const isKill = pull.bossPct === 0;
    fights.push({
      id,
      name: "Ula'tek",
      encounterID: 3131,
      difficulty: 5,
      kill: isKill,
      startTime,
      endTime,
      fightPercentage: pull.bossPct,
      lastPhase: pull.phase,
      size: ROSTER.length,
      phaseTransitions: buildPhases(startTime, pull.duration, pull.phase),
    });

    eventsByFight.set(
      id,
      buildFightEvents(random, players, bossActorId, startTime, endTime, isKill),
    );
  });

  const report: Report = {
    code: DEMO_REPORT_CODE,
    title: 'Demo — Mythic Prog Night',
    startTime: 0,
    endTime: clock,
    zoneName: 'The Coiled Sanctum',
    fights,
    actors: [
      { id: bossActorId, name: "Ula'tek", type: 'NPC', subType: 'Boss', petOwner: null },
      ...players.map((p) => ({
        id: p.id,
        name: p.name,
        type: 'Player',
        subType: p.className,
        petOwner: null,
      })),
    ],
    abilities,
  };

  return { report, players, eventsByFight };
}

function buildPhases(
  startTime: number,
  durationSec: number,
  lastPhase: number,
): { id: number; startTime: number }[] {
  const phases = [{ id: 1, startTime }];
  if (lastPhase >= 2 && durationSec > 150) {
    phases.push({ id: 2, startTime: startTime + 140_000 });
  }
  if (lastPhase >= 3 && durationSec > 320) {
    phases.push({ id: 3, startTime: startTime + 310_000 });
  }
  return phases;
}

function buildFightEvents(
  random: () => number,
  players: PlayerInfo[],
  bossActorId: number,
  startTime: number,
  endTime: number,
  isKill: boolean,
): FightEvents {
  const durationSec = (endTime - startTime) / 1000;
  const friendlyCasts: CastEvent[] = [];
  const deaths: DeathEvent[] = [];

  for (const player of players) {
    const usable = PLAYER_SPELLS.filter(
      (s) => s.classes === 'all' || s.classes.includes(player.className),
    );
    for (const spell of usable) {
      // Consumables: one use somewhere in the fight, if the raider remembered.
      if (spell.classes === 'all') {
        if (random() < 0.75) {
          const at = spell.id === 6262 ? 0.55 + random() * 0.4 : random() * 0.15;
          friendlyCasts.push(
            cast(startTime + at * durationSec * 1000, player.id, bossActorId, spell.id),
          );
        }
        continue;
      }
      // Class cooldowns: press on cooldown-ish with human sloppiness.
      let at = 5 + random() * spell.cooldown * 0.8;
      while (at < durationSec - 3) {
        if (random() < 0.85) {
          friendlyCasts.push(cast(startTime + at * 1000, player.id, bossActorId, spell.id));
        }
        at += spell.cooldown * (1.05 + random() * 0.5);
      }
    }
  }

  // Wipes kill off part of the raid near the end; kills lose a couple of people early.
  const deathCount = isKill ? 2 : 4 + Math.floor(random() * players.length * 0.6);
  const shuffled = [...players].sort(() => random() - 0.5);
  for (let i = 0; i < deathCount; i++) {
    const frac = isKill ? 0.2 + random() * 0.5 : 0.75 + (i / deathCount) * 0.24;
    deaths.push({
      timestamp: startTime + frac * durationSec * 1000,
      targetID: shuffled[i].id,
      abilityGameID: BOSS_SPELLS[Math.floor(random() * BOSS_SPELLS.length)].id,
    });
  }
  deaths.sort((a, b) => a.timestamp - b.timestamp);

  const enemyCasts: CastEvent[] = [];
  for (const spell of BOSS_SPELLS) {
    for (let at = spell.firstAt; at < durationSec; at += spell.period * (0.95 + random() * 0.1)) {
      enemyCasts.push(cast(startTime + at * 1000, bossActorId, null, spell.id));
    }
  }

  friendlyCasts.sort((a, b) => a.timestamp - b.timestamp);
  enemyCasts.sort((a, b) => a.timestamp - b.timestamp);
  return { friendlyCasts, enemyCasts, deaths };
}

function cast(
  timestamp: number,
  sourceID: number,
  targetID: number | null,
  abilityGameID: number,
): CastEvent {
  return { timestamp: Math.round(timestamp), type: 'cast', sourceID, targetID, abilityGameID };
}
