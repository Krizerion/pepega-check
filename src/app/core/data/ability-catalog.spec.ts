import { classifyAbility } from './ability-catalog';

describe('classifyAbility', () => {
  it('classifies well-known spell IDs', () => {
    expect(classifyAbility(871, 'Shield Wall')).toBe('defensive');
    expect(classifyAbility(642, 'Divine Shield')).toBe('immunity');
    expect(classifyAbility(98008, 'Spirit Link Totem')).toBe('healing-cd');
    expect(classifyAbility(190319, 'Combustion')).toBe('offensive');
    expect(classifyAbility(6262, 'Healthstone')).toBe('health-pot');
    expect(classifyAbility(431932, 'Tempered Potion')).toBe('combat-pot');
    expect(classifyAbility(2825, 'Bloodlust')).toBe('utility');
  });

  it('classifies Midnight consumables', () => {
    expect(classifyAbility(1236994, 'Potion of Recklessness')).toBe('combat-pot');
    expect(classifyAbility(1250533, "Freightrunner's Flask")).toBe('combat-pot');
    expect(classifyAbility(1236648, 'Lightfused Mana Potion')).toBe('combat-pot');
    expect(classifyAbility(1234768, 'Silvermoon Health Potion')).toBe('health-pot');
    expect(classifyAbility(452930, 'Demonic Healthstone')).toBe('health-pot');
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
