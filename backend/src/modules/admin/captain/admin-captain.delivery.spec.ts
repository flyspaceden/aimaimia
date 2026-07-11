import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('captain configuration delivery guards', () => {
  it('captures the fixed RuleConfig key for reversible captain settings audit', () => {
    const source = readFileSync(resolve(__dirname, 'admin-captain.controller.ts'), 'utf8');
    expect(source).toContain('targetIdValue: CAPTAIN_SEAFOOD_CONFIG_KEY');
  });

  it('does not overwrite an existing captain configuration during seed', () => {
    const source = readFileSync(resolve(__dirname, '../../../../prisma/seed.ts'), 'utf8');
    const seedLoop = source.slice(source.indexOf('for (const rc of ruleConfigs)'));
    expect(seedLoop).not.toMatch(/update:\s*rc\.key[^\n]*CAPTAIN_SEAFOOD_CONFIG_KEY/);
  });
});
