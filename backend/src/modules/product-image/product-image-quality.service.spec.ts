const sharp = require('sharp') as typeof import('sharp').default;
import { ProductImageQualityService } from './product-image-quality.service';

describe('ProductImageQualityService', () => {
  const service = new ProductImageQualityService();

  async function solidImage(
    width: number,
    height: number,
    background: { r: number; g: number; b: number },
  ): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 3, background },
    })
      .png()
      .toBuffer();
  }

  it('reports a ready-to-preview 4:5 image without a brightness or crop advisory', async () => {
    const source = await solidImage(800, 1000, { r: 128, g: 128, b: 128 });
    const snapshot = Buffer.from(source);

    const result = await service.analyze(source);

    expect(result).toMatchObject({
      width: 800,
      height: 1000,
      aspectRatio: 0.8,
      tooSmall: false,
      portraitCropRisk: false,
      hasTransparentPixels: false,
      brightness: { mean: 128, advisory: null },
      contrast: { standardDeviation: 0, advisory: 'LOW_CONTRAST' },
    });
    expect(result.advisories).toEqual([{ code: 'LOW_CONTRAST', severity: 'warning' }]);
    expect(source.equals(snapshot)).toBe(true);
  });

  it('reports actual transparent pixels for the free alpha-composite path', async () => {
    const source = await sharp({
      create: { width: 800, height: 1000, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
    }).png().toBuffer();

    await expect(service.analyze(source)).resolves.toMatchObject({ hasTransparentPixels: true });
  });

  it('does not treat an opaque four-channel PNG as a transparent foreground', async () => {
    const source = await sharp({
      create: { width: 800, height: 1000, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();

    await expect(service.analyze(source)).resolves.toMatchObject({ hasTransparentPixels: false });
  });

  it('warns when a tall image will crop in the 4:5 product-card frame', async () => {
    const result = await service.analyze(
      await solidImage(900, 1600, { r: 128, g: 128, b: 128 }),
    );

    expect(result.aspectRatio).toBe(0.56);
    expect(result.tooSmall).toBe(false);
    expect(result.portraitCropRisk).toBe(true);
    expect(result.advisories).toContainEqual({
      code: 'PORTRAIT_CROP_RISK',
      severity: 'warning',
    });
  });

  it('returns retake-facing low-size, dark, and low-contrast advisories', async () => {
    const result = await service.analyze(
      await solidImage(600, 600, { r: 15, g: 15, b: 15 }),
    );

    expect(result.tooSmall).toBe(true);
    expect(result.brightness).toEqual({ mean: 15, advisory: 'TOO_DARK' });
    expect(result.contrast).toEqual({
      standardDeviation: 0,
      advisory: 'LOW_CONTRAST',
    });
    expect(result.advisories.map((advisory) => advisory.code)).toEqual([
      'IMAGE_TOO_SMALL',
      'TOO_DARK',
      'LOW_CONTRAST',
    ]);
  });

  it('identifies over-bright images', async () => {
    const result = await service.analyze(
      await solidImage(1000, 1250, { r: 240, g: 240, b: 240 }),
    );

    expect(result.brightness).toEqual({ mean: 240, advisory: 'TOO_BRIGHT' });
    expect(result.advisories).toContainEqual({
      code: 'TOO_BRIGHT',
      severity: 'warning',
    });
  });
});
