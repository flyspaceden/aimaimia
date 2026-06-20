import { resolveDeliverySeedPassword } from './seed-security';

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
});
