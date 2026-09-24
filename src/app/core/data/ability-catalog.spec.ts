import { ABILITY_COOLDOWNS, CATEGORIES, classifyAbility } from './ability-catalog';

describe('ABILITY_COOLDOWNS', () => {
  it('only lists plausible cooldowns', () => {
    for (const [id, seconds] of Object.entries(ABILITY_COOLDOWNS)) {
      expect(seconds, `spell ${id}`).toBeGreaterThan(0);
      expect(seconds, `spell ${id}`).toBeLessThanOrEqual(900);
    }
  });

  it('covers the defensives most likely to be questioned after a death', () => {
    // A sample across roles; the table is deliberately partial but these
    // are the ones a raid leader will ask about first.
    for (const id of [871, 642, 48792, 108271, 22812, 45438, 198589, 363916]) {
      expect(ABILITY_COOLDOWNS[id], `spell ${id}`).toBeDefined();
    }
  });

  it('exposes Raid CDs as a category', () => {
    expect(CATEGORIES.map((c) => c.id)).toContain('raid-cd');
    expect(CATEGORIES.find((c) => c.id === 'raid-cd')?.label).toBe('Raid CDs');
  });
});

describe('classifyAbility', () => {
  it('classifies well-known spell IDs', () => {
    expect(classifyAbility(871, 'Shield Wall')).toBe('defensive');
    expect(classifyAbility(642, 'Divine Shield')).toBe('immunity');
    expect(classifyAbility(98008, 'Spirit Link Totem')).toBe('raid-cd');
    expect(classifyAbility(190319, 'Combustion')).toBe('offensive');
    expect(classifyAbility(6262, 'Healthstone')).toBe('health-pot');
    expect(classifyAbility(431932, 'Tempered Potion')).toBe('combat-pot');
    expect(classifyAbility(2825, 'Bloodlust')).toBe('utility');
  });

  it('classifies Midnight consumables', () => {
    expect(classifyAbility(1236994, 'Potion of Recklessness')).toBe('combat-pot');
    expect(classifyAbility(1236616, "Light's Potential")).toBe('combat-pot');
    expect(classifyAbility(1295132, 'Liquid Luster')).toBe('combat-pot');
    expect(classifyAbility(1236998, 'Draught of Rampant Abandon')).toBe('combat-pot');
    expect(classifyAbility(1236648, 'Lightfused Mana Potion')).toBe('combat-pot');
    expect(classifyAbility(1234768, 'Silvermoon Health Potion')).toBe('health-pot');
    expect(classifyAbility(1263074, 'Amani Extract')).toBe('health-pot');
    expect(classifyAbility(452930, 'Demonic Healthstone')).toBe('health-pot');
  });

  it('does not classify stat flasks as combat pots', () => {
    expect(classifyAbility(1250533, "Freightrunner's Flask")).toBeNull();
    expect(classifyAbility(1235110, 'Flask of the Blood Knights')).toBeNull();
  });

  it('does not count crafting spells as consumable usage', () => {
    expect(classifyAbility(6201, 'Create Healthstone')).toBeNull();
  });

  it('falls back to name patterns for unknown consumable IDs', () => {
    expect(classifyAbility(999999, 'Fancy New Healing Potion')).toBe('health-pot');
    expect(classifyAbility(999996, 'Silvermoon Health Potion')).toBe('health-pot');
    expect(classifyAbility(999997, 'Demonic Healthstone')).toBe('health-pot');
    expect(classifyAbility(999998, 'Potion of Future Expansions')).toBe('combat-pot');
    expect(classifyAbility(999995, 'Grand Mana Potion')).toBe('combat-pot');
  });

  it('returns null for rotational abilities', () => {
    expect(classifyAbility(100, 'Charge')).toBeNull();
    expect(classifyAbility(133, 'Fireball')).toBeNull();
    expect(classifyAbility(0, null)).toBeNull();
  });
});
