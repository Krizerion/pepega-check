import { classifyAbility } from './ability-catalog';

describe('classifyAbility', () => {
  it('classifies well-known spell IDs', () => {
    expect(classifyAbility(871, 'Shield Wall')).toBe('defensive');
    expect(classifyAbility(642, 'Divine Shield')).toBe('immunity');
    expect(classifyAbility(98008, 'Spirit Link Totem')).toBe('healing-cd');
    expect(classifyAbility(190319, 'Combustion')).toBe('offensive');
    expect(classifyAbility(6262, 'Healthstone')).toBe('potion');
    expect(classifyAbility(2825, 'Bloodlust')).toBe('utility');
  });

  it('falls back to name patterns for unknown consumable IDs', () => {
    expect(classifyAbility(999999, 'Fancy New Healing Potion')).toBe('potion');
    expect(classifyAbility(999998, 'Potion of Future Expansions')).toBe('potion');
    expect(classifyAbility(999997, 'Invigorating Healthstone')).toBe('potion');
  });

  it('returns null for rotational abilities', () => {
    expect(classifyAbility(100, 'Charge')).toBeNull();
    expect(classifyAbility(133, 'Fireball')).toBeNull();
    expect(classifyAbility(0, null)).toBeNull();
  });
});
