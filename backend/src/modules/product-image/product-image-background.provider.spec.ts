import { DisabledProductImageBackgroundProvider } from './product-image-background.provider';

describe('DisabledProductImageBackgroundProvider', () => {
  it('fails closed even if provider-shaped configuration is present', async () => {
    const provider = new DisabledProductImageBackgroundProvider();
    expect(provider.isAvailable()).toBe(false);
    await expect(provider.create({ foregroundUrl: 'https://example.invalid/a.png', preset: 'NEUTRAL_STUDIO' })).rejects.toThrow('尚未配置');
  });
});
