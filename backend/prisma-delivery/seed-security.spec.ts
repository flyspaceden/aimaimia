import { resolveDeliverySeedPassword } from './seed-security';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('resolveDeliverySeedPassword', () => {
  it('rejects missing seed password instead of falling back to a public default', () => {
    expect(() => resolveDeliverySeedPassword({})).toThrow(
      /DELIVERY_SEED_PASSWORD/,
    );
  });

  it('accepts an explicitly configured seed password', () => {
    expect(
      resolveDeliverySeedPassword({
        DELIVERY_SEED_PASSWORD: 'DeliverySeedConfiguredPassword@2026!',
      }),
    ).toBe('DeliverySeedConfiguredPassword@2026!');
  });

  it('keeps the delivery center seed owner on the documented test phone', () => {
    const seedSource = readFileSync(join(__dirname, 'seed.ts'), 'utf8');

    expect(seedSource).toContain("username: 'delivery_seed_owner'");
    expect(seedSource).toContain("phone: '13800001001'");
    expect(seedSource).not.toContain("phone: '13800001011'");
  });
});
