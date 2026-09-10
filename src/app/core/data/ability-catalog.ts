/**
 * Curated catalog of "interesting" player abilities, grouped into filterable
 * categories. Spell IDs are stable across expansions for class abilities;
 * consumables rotate every expansion, so name-based fallbacks cover new potions.
 */

export type AbilityCategory =
  | 'defensive'
  | 'immunity'
  | 'healing-cd'
  | 'offensive'
  | 'movement'
  | 'utility'
  | 'health-pot'
  | 'combat-pot';

export interface CategoryMeta {
  id: AbilityCategory;
  label: string;
  color: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'defensive', label: 'Defensives', color: '#f5a524' },
  { id: 'immunity', label: 'Immunities', color: '#ffd60a' },
  { id: 'healing-cd', label: 'Healing CDs', color: '#46a758' },
  { id: 'offensive', label: 'Offensive CDs', color: '#e5484d' },
  { id: 'movement', label: 'Movement', color: '#3fc7eb' },
  { id: 'utility', label: 'Utility', color: '#8788ee' },
  { id: 'health-pot', label: 'Health Pots & Stones', color: '#f48cba' },
  { id: 'combat-pot', label: 'Combat Pots', color: '#c084fc' },
];

const byCategory: Record<AbilityCategory, number[]> = {
  defensive: [
    // Warrior
    871, // Shield Wall
    12975, // Last Stand
    118038, // Die by the Sword
    184364, // Enraged Regeneration
    23920, // Spell Reflection
    // Paladin
    31850, // Ardent Defender
    86659, // Guardian of Ancient Kings
    184662, // Shield of Vengeance
    498, // Divine Protection
    403876, // Divine Protection (retail rework)
    389539, // Sentinel
    // Hunter
    264735, // Survival of the Fittest
    109304, // Exhilaration
    // Rogue
    5277, // Evasion
    1966, // Feint
    185311, // Crimson Vial
    // Priest
    47585, // Dispersion
    19236, // Desperate Prayer
    47536, // Rapture
    // Death Knight
    48792, // Icebound Fortitude
    48707, // Anti-Magic Shell
    55233, // Vampiric Blood
    49028, // Dancing Rune Weapon
    49039, // Lichborne
    48743, // Death Pact
    // Shaman
    108271, // Astral Shift
    108270, // Stone Bulwark Totem
    // Mage
    342245, // Alter Time
    110959, // Greater Invisibility
    55342, // Mirror Image
    235450, // Prismatic Barrier
    235313, // Blazing Barrier
    11426, // Ice Barrier
    // Warlock
    104773, // Unending Resolve
    108416, // Dark Pact
    // Monk
    115203, // Fortifying Brew
    115176, // Zen Meditation
    122278, // Dampen Harm
    122783, // Diffuse Magic
    122470, // Touch of Karma
    322507, // Celestial Brew
    // Druid
    22812, // Barkskin
    61336, // Survival Instincts
    108238, // Renewal
    // Demon Hunter
    198589, // Blur
    187827, // Metamorphosis (Vengeance)
    204021, // Fiery Brand
    // Evoker
    363916, // Obsidian Scales
    374348, // Renewing Blaze
    374227, // Zephyr
  ],
  immunity: [
    642, // Divine Shield
    186265, // Aspect of the Turtle
    31224, // Cloak of Shadows
    45438, // Ice Block
    196555, // Netherwalk
    1022, // Blessing of Protection
    204018, // Blessing of Spellwarding
  ],
  'healing-cd': [
    // Paladin
    31821, // Aura Mastery
    633, // Lay on Hands
    // Priest
    62618, // Power Word: Barrier
    33206, // Pain Suppression
    47788, // Guardian Spirit
    64843, // Divine Hymn
    15286, // Vampiric Embrace
    // Shaman
    98008, // Spirit Link Totem
    108280, // Healing Tide Totem
    108281, // Ancestral Guidance
    207399, // Ancestral Protection Totem
    114052, // Ascendance (Restoration)
    // Monk
    116849, // Life Cocoon
    115310, // Revival
    388615, // Restoral
    322118, // Invoke Yu'lon
    325197, // Invoke Chi-Ji
    // Druid
    740, // Tranquility
    102342, // Ironbark
    197721, // Flourish
    // Evoker
    363534, // Rewind
    359816, // Dream Flight
    370960, // Emerald Communion
    357170, // Time Dilation
    // Death Knight
    51052, // Anti-Magic Zone
    // Demon Hunter
    196718, // Darkness
    // Warrior
    97462, // Rallying Cry
    // Mage
    414660, // Mass Barrier
  ],
  offensive: [
    // Warrior
    107574, // Avatar
    1719, // Recklessness
    227847, // Bladestorm
    228920, // Ravager
    // Paladin
    31884, // Avenging Wrath
    231895, // Crusade
    // Hunter
    288613, // Trueshot
    360952, // Coordinated Assault
    19574, // Bestial Wrath
    359844, // Call of the Wild
    // Rogue
    13750, // Adrenaline Rush
    121471, // Shadow Blades
    360194, // Deathmark
    // Priest
    194249, // Voidform
    391109, // Dark Ascension
    200183, // Apotheosis
    246287, // Evangelism
    // Death Knight
    51271, // Pillar of Frost
    152279, // Breath of Sindragosa
    207289, // Unholy Assault
    275699, // Apocalypse
    42650, // Army of the Dead
    383269, // Abomination Limb
    // Shaman
    114050, // Ascendance (Elemental)
    114051, // Ascendance (Enhancement)
    198067, // Fire Elemental
    192249, // Storm Elemental
    51533, // Feral Spirit
    384352, // Doom Winds
    191634, // Stormkeeper
    // Mage
    12472, // Icy Veins
    190319, // Combustion
    365350, // Arcane Surge
    // Warlock
    1122, // Summon Infernal
    205180, // Summon Darkglare
    265187, // Summon Demonic Tyrant
    // Monk
    137639, // Storm, Earth, and Fire
    123904, // Invoke Xuen
    // Druid
    391528, // Convoke the Spirits
    194223, // Celestial Alignment
    102560, // Incarnation: Chosen of Elune
    102543, // Incarnation: Avatar of Ashamane
    106951, // Berserk
    // Demon Hunter
    191427, // Metamorphosis (Havoc)
    370965, // The Hunt
    // Evoker
    375087, // Dragonrage
    403631, // Breath of Eons
    395152, // Ebon Might
  ],
  movement: [
    6544, // Heroic Leap
    190784, // Divine Steed
    186257, // Aspect of the Cheetah
    2983, // Sprint
    36554, // Shadowstep
    73325, // Leap of Faith
    121536, // Angelic Feather
    48265, // Death's Advance
    212552, // Wraith Walk
    58875, // Spirit Walk
    79206, // Spiritwalker's Grace
    1953, // Blink
    212653, // Shimmer
    48020, // Demonic Circle: Teleport
    109132, // Roll
    115008, // Chi Torpedo
    116841, // Tiger's Lust
    252216, // Tiger Dash
    1850, // Dash
    102401, // Wild Charge
    106898, // Stampeding Roar
    77764, // Stampeding Roar (Bear)
    195072, // Fel Rush
    189110, // Infernal Strike
    358267, // Hover
    // Evoker rescue
    370665, // Rescue
  ],
  utility: [
    2825, // Bloodlust
    32182, // Heroism
    80353, // Time Warp
    390386, // Fury of the Aspects
    10060, // Power Infusion
    29166, // Innervate
    20484, // Rebirth
    61999, // Raise Ally
    20707, // Soulstone
    95750, // Soulstone Resurrection
    1856, // Vanish
    370553, // Tip the Scales
    114018, // Shroud of Concealment
    64901, // Symbol of Hope
    108199, // Gorefiend's Grasp
    192077, // Wind Rush Totem
  ],
  'health-pot': [
    6262, // Healthstone
    431416, // Algari Healing Potion
    452930, // Cavedweller's Delight
  ],
  'combat-pot': [
    // The War Within combat consumables
    431932, // Tempered Potion
    431914, // Potion of Unwavering Focus
    431925, // Frontline Potion
  ],
};

/**
 * Name-based fallbacks so newly-released consumables (whose spell IDs change
 * every expansion) are still classified without a catalog update.
 */
const NAME_PATTERNS: { pattern: RegExp; category: AbilityCategory }[] = [
  { pattern: /healthstone/i, category: 'health-pot' },
  { pattern: /health(?:ing)? potion/i, category: 'health-pot' },
  { pattern: /\bpotion\b/i, category: 'combat-pot' },
  { pattern: /bloodlust|heroism|time warp|fury of the aspects/i, category: 'utility' },
];

const categoryBySpellId = new Map<number, AbilityCategory>();
for (const [category, ids] of Object.entries(byCategory) as [AbilityCategory, number[]][]) {
  for (const id of ids) {
    categoryBySpellId.set(id, category);
  }
}

/** Classifies a player's cast; returns null for uninteresting (rotational) spells. */
export function classifyAbility(spellId: number, name: string | null): AbilityCategory | null {
  const byId = categoryBySpellId.get(spellId);
  if (byId) {
    return byId;
  }
  if (name) {
    for (const { pattern, category } of NAME_PATTERNS) {
      if (pattern.test(name)) {
        return category;
      }
    }
  }
  return null;
}

export const CATEGORY_META = new Map(CATEGORIES.map((c) => [c.id, c]));
