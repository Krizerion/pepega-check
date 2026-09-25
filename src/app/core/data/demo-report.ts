import {
  CastEvent,
  DamageEvent,
  DeathEvent,
  DispelEvent,
  FightEvents,
  HealEvent,
  FightPerformance,
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

/**
 * Real Entombed Sentinels abilities (ids, names and icons taken from a live
 * log) so Wowhead tooltips resolve in demo mode just as they do on a real
 * report. The cast timings below are invented.
 */
const BOSS_SPELLS: (DemoSpell & { period: number; firstAt: number })[] = [
  {
    id: 1284487,
    name: 'Bloodvenom Injection',
    icon: 'ability_warrior_bloodbath.jpg',
    cooldown: 0,
    classes: 'all',
    period: 60,
    firstAt: 8,
  },
  {
    id: 1284458,
    name: 'Empowering Slam',
    icon: 'inv_mace_1h_pvppandarias3_c_01.jpg',
    cooldown: 0,
    classes: 'all',
    period: 90,
    firstAt: 25,
  },
  {
    id: 1284434,
    name: 'Toxic Droplets',
    icon: 'inv_ability_poison_orb.jpg',
    cooldown: 0,
    classes: 'all',
    period: 45,
    firstAt: 40,
  },
  {
    id: 1288232,
    name: 'Unstable Miasma',
    icon: 'ability_deathwing_bloodcorruption_death.jpg',
    cooldown: 0,
    classes: 'all',
    period: 120,
    firstAt: 105,
  },
  {
    id: 1284251,
    name: 'Venom Coagulation',
    icon: 'inv_ability_poison_nova.jpg',
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
  damageByFight: Map<number, DamageEvent[]>;
  dispelsByFight: Map<number, DispelEvent[]>;
  healingByFight: Map<number, HealEvent[]>;
}

/** Real healing spell ids, so the demo's heal events link somewhere sensible. */
const DEMO_HEAL_ID = 77472;
const DEMO_HOT_ID = 139;

/** The (real) debuff the demo's healers cleanse. */
const DEMO_DEBUFF_ID = 1284471;

/** Actor id for the hunter's pet, above every player's. */
const PET_ACTOR_ID = 900;

/**
 * Who might press the haste buff. `className: null` is the hunter pet's Primal
 * Rage, which the log credits to the pet — the case worth having in the demo.
 */
const LUST_OPTIONS: { id: number; name: string; icon: string; className: string | null }[] = [
  { id: 2825, name: 'Bloodlust', icon: 'spell_nature_bloodlust.jpg', className: 'Shaman' },
  { id: 80353, name: 'Time Warp', icon: 'ability_mage_timewarp.jpg', className: 'Mage' },
  {
    id: 390386,
    name: 'Fury of the Aspects',
    icon: 'ability_evoker_furyoftheaspects.jpg',
    className: 'Evoker',
  },
  { id: 264667, name: 'Primal Rage', icon: 'ability_hunter_bloodlust.jpg', className: null },
  // An item rather than a class ability, so anyone can be the one carrying them.
  { id: 381301, name: 'Feral Hide Drums', icon: 'inv_misc_drum_01.jpg', className: 'Rogue' },
];

/** Battle rezzes available to the demo roster. */
const REZ_OPTIONS: { id: number; name: string; icon: string; className: string }[] = [
  { id: 20484, name: 'Rebirth', icon: 'spell_nature_reincarnation.jpg', className: 'Druid' },
  {
    id: 61999,
    name: 'Raise Ally',
    icon: 'spell_shadow_deadofnight.jpg',
    className: 'DeathKnight',
  },
  { id: 20707, name: 'Soulstone', icon: 'spell_shadow_soulgem.jpg', className: 'Warlock' },
  {
    id: 391054,
    name: 'Intercession',
    icon: 'spell_holy_nullifydisease.jpg',
    className: 'Paladin',
  },
];

/** Dispel spells the demo healers use, with the debuff they remove. */
const DEMO_DISPELS: { className: string; spellId: number; name: string; icon: string }[] = [
  { className: 'Priest', spellId: 527, name: 'Purify', icon: 'spell_holy_dispelmagic.jpg' },
  { className: 'Shaman', spellId: 77130, name: 'Purify Spirit', icon: 'spell_nature_purge.jpg' },
  { className: 'Druid', spellId: 88423, name: "Nature's Cure", icon: 'ability_druid_nourish.jpg' },
  { className: 'Paladin', spellId: 4987, name: 'Cleanse', icon: 'spell_holy_renew.jpg' },
];

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
    [
      ...PLAYER_SPELLS,
      ...BOSS_SPELLS,
      ...DEMO_DISPELS.map((d) => ({ ...d, id: d.spellId })),
      ...LUST_OPTIONS,
      ...REZ_OPTIONS,
    ].map((s) => [s.id, { gameID: s.id, name: s.name, icon: s.icon, type: null }]),
  );
  abilities.set(DEMO_DEBUFF_ID, {
    gameID: DEMO_DEBUFF_ID,
    name: 'Bloodvenom',
    icon: 'ability_creature_poison_02.jpg',
    type: null,
  });

  const fights: ReportFight[] = [];
  const eventsByFight = new Map<number, FightEvents>();
  const damageByFight = new Map<number, DamageEvent[]>();
  const dispelsByFight = new Map<number, DispelEvent[]>();
  const healingByFight = new Map<number, HealEvent[]>();
  let clock = 10 * 60_000;

  PULLS.forEach((pull, index) => {
    const id = index + 1;
    const startTime = clock;
    const endTime = startTime + pull.duration * 1000;
    clock = endTime + (120 + Math.floor(random() * 300)) * 1000;

    const isKill = pull.bossPct === 0;
    fights.push({
      id,
      name: 'Entombed Sentinels',
      encounterID: 3445,
      difficulty: 5,
      kill: isKill,
      startTime,
      endTime,
      fightPercentage: pull.bossPct,
      lastPhase: pull.phase,
      size: ROSTER.length,
      phaseTransitions: buildPhases(startTime, pull.duration, pull.phase),
    });

    const fightEvents = buildFightEvents(random, players, bossActorId, startTime, endTime, isKill);
    const damageEvents = buildDamageEvents(id, players, bossActorId, fightEvents);
    alignDeathsToDamage(fightEvents.deaths, damageEvents);
    const healEvents = buildHealEvents(id, players, startTime, endTime);
    simulateHealth(players, damageEvents, healEvents, fightEvents.deaths, random);
    eventsByFight.set(id, fightEvents);
    damageByFight.set(id, damageEvents);
    healingByFight.set(id, healEvents);
    dispelsByFight.set(id, buildDispelEvents(id, players, startTime, endTime));
  });

  const report: Report = {
    code: DEMO_REPORT_CODE,
    title: 'Demo — Mythic Prog Night',
    startTime: 0,
    endTime: clock,
    zoneName: 'The Venomous Abyss',
    fights,
    actors: [
      { id: bossActorId, name: 'Entombed Sentinels', type: 'NPC', subType: 'Boss', petOwner: null },
      ...players.map((p) => ({
        id: p.id,
        name: p.name,
        type: 'Player',
        subType: p.className,
        petOwner: null,
      })),
      // The hunter's pet, so the demo exercises a Primal Rage credited to its
      // owner rather than to "Bloodpaw".
      {
        id: PET_ACTOR_ID,
        name: 'Bloodpaw',
        type: 'Pet',
        subType: 'Hunter',
        petOwner: players.find((p) => p.className === 'Hunter')?.id ?? null,
      },
    ],
    abilities,
  };

  return { report, players, eventsByFight, damageByFight, dispelsByFight, healingByFight };
}

/** Synthetic dispels: the demo's dispel-capable healers cleanse a poison debuff. */
/** Roughly what a raider of this role has in Midnight-era gear. */
function maxHealth(role: string): number {
  return role === 'tank' ? 4_500_000 : 2_600_000;
}

/** Steady healing onto the raid, so a death window has something to consolidate. */
function buildHealEvents(
  fightId: number,
  players: PlayerInfo[],
  startTime: number,
  endTime: number,
): HealEvent[] {
  const random = mulberry32(0xbeef + fightId);
  const healers = players.filter((p) => p.role === 'healer');
  const heals: HealEvent[] = [];
  if (healers.length === 0) {
    return heals;
  }

  for (const target of players) {
    // Tanks get attention constantly; everyone else between mechanics. Most of
    // it is HoT ticks of a few thousand, as in a real log — which is exactly
    // why the death log folds runs of them together.
    const period = target.role === 'tank' ? 700 : 1500;
    let at = startTime + random() * period;
    while (at < endTime) {
      const healer = healers[Math.floor(random() * healers.length)];
      const big = random() < 0.12;
      heals.push({
        timestamp: Math.round(at),
        sourceID: healer.id,
        targetID: target.id,
        abilityGameID: big ? DEMO_HEAL_ID : DEMO_HOT_ID,
        amount: big
          ? Math.round(180_000 + random() * 420_000)
          : Math.round(1_000 + random() * 28_000),
        overheal: random() < 0.35 ? Math.round(random() * 40_000) : 0,
      });
      at += period * (0.5 + random() * 0.9);
    }
  }
  return heals.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Walks each raider's damage and healing in order to fill in `hitPoints`, the
 * field Warcraft Logs carries on every such event. Without it the death log
 * cannot say what someone was sitting at when a mechanic landed.
 */
function simulateHealth(
  players: PlayerInfo[],
  damage: DamageEvent[],
  healing: HealEvent[],
  deaths: DeathEvent[],
  random: () => number,
): void {
  const fatal = new Set(deaths.map((d) => `${d.targetID}:${d.timestamp}`));
  const byPlayer = new Map<number, { at: number; hit?: DamageEvent; heal?: HealEvent }[]>();

  const push = (id: number, entry: { at: number; hit?: DamageEvent; heal?: HealEvent }) => {
    const bucket = byPlayer.get(id);
    if (bucket) {
      bucket.push(entry);
    } else {
      byPlayer.set(id, [entry]);
    }
  };
  for (const hit of damage) {
    push(hit.targetID, { at: hit.timestamp, hit });
  }
  for (const heal of healing) {
    push(heal.targetID, { at: heal.timestamp, heal });
  }

  for (const player of players) {
    const max = maxHealth(player.role);
    const timeline = (byPlayer.get(player.id) ?? []).sort((a, b) => a.at - b.at);
    let hp = max;

    for (const entry of timeline) {
      if (entry.hit) {
        if (fatal.has(`${player.id}:${entry.hit.timestamp}`)) {
          // Make the blow genuinely lethal: it has to cover the health that was
          // left, plus the overkill, or the log reads as a 180k hit killing
          // someone who was at 94%.
          const overkill = Math.round(hp * (0.05 + random() * 0.35));
          entry.hit.amount = hp + overkill;
          entry.hit.overkill = overkill;
          hp = 0;
        } else {
          // Never bottom out on a non-fatal hit: 0 hp while alive reads as a bug.
          hp = Math.max(Math.round(max * 0.05), hp - entry.hit.amount);
        }
        entry.hit.hitPoints = hp;
        entry.hit.maxHitPoints = max;
      } else if (entry.heal) {
        hp = hp === 0 ? 0 : Math.min(max, hp + entry.heal.amount);
        entry.heal.hitPoints = hp;
        entry.heal.maxHitPoints = max;
      }
    }
  }
}

function buildDispelEvents(
  fightId: number,
  players: PlayerInfo[],
  startTime: number,
  endTime: number,
): DispelEvent[] {
  const random = mulberry32(0xd15e1 + fightId);
  const dispellers = players.filter(
    (p) => p.role === 'healer' && DEMO_DISPELS.some((d) => d.className === p.className),
  );
  const events: DispelEvent[] = [];
  for (const player of dispellers) {
    const spell = DEMO_DISPELS.find((d) => d.className === player.className)!;
    const count = 2 + Math.floor(random() * 6);
    for (let i = 0; i < count; i++) {
      events.push({
        timestamp: Math.round(startTime + random() * (endTime - startTime)),
        sourceID: player.id,
        targetID: players[Math.floor(random() * players.length)].id,
        abilityGameID: spell.spellId,
        extraAbilityGameID: DEMO_DEBUFF_ID,
        isBuff: false,
      });
    }
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/** Synthetic per-player damage/healing totals + parses for the demo report. */
export function buildDemoPerformance(fight: ReportFight, players: PlayerInfo[]): FightPerformance {
  const random = mulberry32(0xbeef + fight.id);
  const seconds = (fight.endTime - fight.startTime) / 1000;
  const entries = players.map((p) => {
    const dps =
      p.role === 'dps'
        ? 1_500_000 + random() * 900_000
        : p.role === 'tank'
          ? 700_000 + random() * 300_000
          : 200_000 + random() * 150_000;
    const hps =
      p.role === 'healer'
        ? 1_100_000 + random() * 600_000
        : p.role === 'tank'
          ? 150_000 + random() * 100_000
          : 30_000 + random() * 60_000;
    return {
      actorId: p.id,
      name: p.name,
      damage: Math.round(dps * seconds),
      healing: Math.round(hps * seconds),
    };
  });
  const parses = fight.kill
    ? Object.fromEntries(players.map((p) => [p.name, Math.round(15 + random() * 84)]))
    : null;
  return { entries, parses };
}

/** Synthetic damage-taken ticks: each boss cast clips a few random raiders. */
function buildDamageEvents(
  fightId: number,
  players: PlayerInfo[],
  bossActorId: number,
  events: FightEvents,
): DamageEvent[] {
  const random = mulberry32(0xd00d + fightId);
  const damage: DamageEvent[] = [];
  for (const cast of events.enemyCasts) {
    const victims = 2 + Math.floor(random() * 7);
    const pool = [...players].sort(() => random() - 0.5).slice(0, victims);
    for (const victim of pool) {
      // Real mechanics rarely land as a single tick — most leave a short dot or
      // pulse a few times. One tick per cast made every death look like a lone
      // hit out of nowhere, which is exactly what the death timeline is meant
      // to disprove.
      const ticks = 1 + Math.floor(random() * 3);
      const total = 150_000 + random() * 550_000;
      const first = cast.timestamp + random() * 2000;
      for (let i = 0; i < ticks; i++) {
        damage.push({
          timestamp: Math.round(first + i * (900 + random() * 1600)),
          sourceID: bossActorId,
          targetID: victim.id,
          abilityGameID: cast.abilityGameID,
          amount: Math.round(total / ticks),
          absorbed: random() < 0.3 ? Math.round((random() * 120_000) / ticks) : 0,
        });
      }
    }
  }
  return damage.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Pins each death to a real hit the player took.
 *
 * Deaths are generated independently of the damage ticks, so without this a
 * demo death names an ability that never actually hit that player. Warcraft
 * Logs timestamps a death at its killing blow, so the demo should too.
 */
function alignDeathsToDamage(deaths: DeathEvent[], damage: DamageEvent[]): void {
  for (const death of deaths) {
    let killer: DamageEvent | null = null;
    for (const hit of damage) {
      if (hit.targetID !== death.targetID || hit.timestamp > death.timestamp) {
        continue;
      }
      if (!killer || hit.timestamp > killer.timestamp) {
        killer = hit;
      }
    }
    if (killer) {
      death.timestamp = killer.timestamp;
      death.abilityGameID = killer.abilityGameID;
      death.killingAbilityGameID = killer.abilityGameID;
    }
  }
  deaths.sort((a, b) => a.timestamp - b.timestamp);
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

  // The haste buff: usually pressed a little way in, by whoever has one. Every
  // so often nobody does, which is exactly the case the analysis calls out.
  if (random() < 0.85) {
    const option = LUST_OPTIONS[Math.floor(random() * LUST_OPTIONS.length)];
    const caster =
      option.className === null
        ? { id: PET_ACTOR_ID }
        : players.find((p) => p.className === option.className);
    if (caster) {
      friendlyCasts.push(
        cast(startTime + (0.12 + random() * 0.25) * durationSec * 1000, caster.id, null, option.id),
      );
    }
  }

  // Wipes kill off part of the raid near the end; kills lose a couple of people early.
  const deathCount = isKill ? 2 : 4 + Math.floor(random() * players.length * 0.6);
  const shuffled = [...players].sort(() => random() - 0.5);
  for (let i = 0; i < deathCount; i++) {
    const frac = isKill ? 0.2 + random() * 0.5 : 0.75 + (i / deathCount) * 0.24;
    const victim = shuffled[i];
    deaths.push({
      timestamp: startTime + frac * durationSec * 1000,
      targetID: victim.id,
      abilityGameID: BOSS_SPELLS[Math.floor(random() * BOSS_SPELLS.length)].id,
    });

    // Someone with a rez usually picks an early death back up.
    if (frac < 0.7 && random() < 0.6) {
      const option = REZ_OPTIONS[Math.floor(random() * REZ_OPTIONS.length)];
      const rezzer = players.find((p) => p.className === option.className && p.id !== victim.id);
      if (rezzer) {
        friendlyCasts.push(
          cast(
            startTime + (frac * durationSec + 4 + random() * 6) * 1000,
            rezzer.id,
            victim.id,
            option.id,
          ),
        );
      }
    }
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
