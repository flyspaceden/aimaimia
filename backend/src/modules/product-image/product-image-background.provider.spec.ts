import { DisabledProductImageBackgroundProvider } from './product-image-background.provider';

describe('DisabledProductImageBackgroundProvider', () => {
  it('fails closed even if provider-shaped configuration is present', async () => {
    const provider = new DisabledProductImageBackgroundProvider();
    expect(provider.isAvailable()).toBe(false);
    await expect(provider.submit({
      foregroundPng: Buffer.from('transparent foreground'),
      foregroundCanonicalSha256: 'source-sha',
      maskArtifactId: 'mask-artifact',
      preset: 'NEUTRAL_STUDIO',
      idempotencyKey: 'background-task-1',
    })).rejects.toThrow('尚未配置');
  });
});
