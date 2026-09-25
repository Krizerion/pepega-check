import catalog from './ability-catalog.json';

/**
 * Curated catalog of "interesting" player abilities, grouped into filterable
 * categories.
 *
 * The data lives in `ability-catalog.json` so a misclassified spell or a new
 * expansion's consumables can be fixed by editing data rather than code. This
 * module only types it and derives the lookups.
 */

export type AbilityCategory =
  | 'defensive'
  | 'immunity'
  | 'raid-cd'
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

export interface CatalogAbility {
  id: number;
  name: string | null;
}

export const CATEGORIES: CategoryMeta[] = catalog.categories as CategoryMeta[];

export const CATEGORY_META = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Spell ids per category, with the names they were catalogued under. */
export const CATALOG_ABILITIES = catalog.abilities as Record<AbilityCategory, CatalogAbility[]>;

/**
 * Base cooldowns in seconds for survival abilities, used to judge what a player
 * still had available when they died.
 *
 * Deliberately incomplete and deliberately conservative: only spells whose base
 * cooldown is well known are listed, and talents that *shorten* a cooldown are
 * ignored. Both choices bias towards under-reporting ("we won't claim it was
 * ready unless it certainly was"), because the cost of wrongly telling someone
 * they sat on a defensive is much higher than missing one.
 */
export const ABILITY_COOLDOWNS: Record<number, number> = Object.fromEntries(
  catalog.cooldowns.map((entry) => [entry.id, entry.seconds]),
);

const categoryBySpellId = new Map<number, AbilityCategory>();
for (const [category, abilities] of Object.entries(CATALOG_ABILITIES) as [
  AbilityCategory,
  CatalogAbility[],
][]) {
  for (const ability of abilities) {
    categoryBySpellId.set(ability.id, category);
  }
}

/**
 * Name-based fallbacks so newly-released consumables (whose spell IDs change
 * every expansion) are still classified without a catalog update.
 */
const NAME_PATTERNS: { pattern: RegExp; category: AbilityCategory }[] = catalog.namePatterns.map(
  (entry) => ({
    pattern: new RegExp(entry.pattern, entry.flags),
    category: entry.category as AbilityCategory,
  }),
);

/** Crafting spells ("Create Healthstone") are not consumable usage. */
const NOT_CONSUMABLE = new RegExp(
  catalog.notConsumablePattern.pattern,
  catalog.notConsumablePattern.flags,
);

/**
 * Raid-wide cooldowns that are counted rather than filtered: the haste buff
 * (Bloodlust and everything that behaves like it) and battle rezzes.
 *
 * They are matched by id first and by name second, because the item-based ones
 * — drums especially — get a fresh spell id every expansion, and a hunter pet's
 * Primal Rage has had several. The name fallback keeps them working without a
 * catalog update.
 */
const lustIds = new Set(catalog.raidCooldowns.lust.map((a) => a.id));
const battleRezIds = new Set(catalog.raidCooldowns.battleRez.map((a) => a.id));
const LUST_PATTERN = new RegExp(
  catalog.raidCooldowns.lustPattern.pattern,
  catalog.raidCooldowns.lustPattern.flags,
);
const BATTLE_REZ_PATTERN = new RegExp(
  catalog.raidCooldowns.battleRezPattern.pattern,
  catalog.raidCooldowns.battleRezPattern.flags,
);

/** True for Bloodlust, Heroism, Time Warp, Primal Rage, drums and friends. */
export function isLust(spellId: number, name: string | null): boolean {
  return lustIds.has(spellId) || (!!name && LUST_PATTERN.test(name));
}

/** True for Rebirth, Raise Ally, Soulstone and Intercession. */
export function isBattleRez(spellId: number, name: string | null): boolean {
  return battleRezIds.has(spellId) || (!!name && BATTLE_REZ_PATTERN.test(name));
}

/** Classifies a player's cast; returns null for uninteresting (rotational) spells. */
export function classifyAbility(spellId: number, name: string | null): AbilityCategory | null {
  const byId = categoryBySpellId.get(spellId);
  if (byId) {
    return byId;
  }
  if (name) {
    if (NOT_CONSUMABLE.test(name)) {
      return null;
    }
    for (const { pattern, category } of NAME_PATTERNS) {
      if (pattern.test(name)) {
        return category;
      }
    }
  }
  return null;
}
