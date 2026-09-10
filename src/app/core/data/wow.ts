/** WoW presentation helpers: class colors and icon URLs. */

export const CLASS_COLORS: Record<string, string> = {
  DeathKnight: '#c41e3a',
  DemonHunter: '#a330c9',
  Druid: '#ff7c0a',
  Evoker: '#33937f',
  Hunter: '#aad372',
  Mage: '#3fc7eb',
  Monk: '#00ff98',
  Paladin: '#f48cba',
  Priest: '#ffffff',
  Rogue: '#fff468',
  Shaman: '#0070dd',
  Warlock: '#8788ee',
  Warrior: '#c69b6d',
};

export function classColor(className: string): string {
  return CLASS_COLORS[className] ?? '#c7c7d1';
}

const ICON_BASE = 'https://assets.rpglogs.com/img/warcraft/abilities/';
const FALLBACK_ICON = 'inv_misc_questionmark.jpg';

/** Builds the ability icon URL from a WCL masterData icon name (e.g. "spell_nature_lightning.jpg"). */
export function abilityIconUrl(icon: string | null | undefined): string {
  return ICON_BASE + (icon || FALLBACK_ICON);
}
