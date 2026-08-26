const sharp = require('sharp') as typeof import('sharp').default;
import { BadRequestException } from '@nestjs/common';
import { ProductImageCompositionService } from './product-image-composition.service';

describe('ProductImageCompositionService', () => {
  const service = new ProductImageCompositionService();

  it('requires a transparent foreground rather than silently redrawing a full image', async () => {
    const source = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ff0000' } }).png().toBuffer();
    await expect(service.composeWhiteBackground(source, { width: 800, height: 1000 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a four-channel image whose alpha channel is fully opaque', async () => {
    const source = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();

    await expect(service.composeWhiteBackground(source, { width: 800, height: 1000 })).rejects.toThrow('实际透明区域');
  });

  it('centers a transparent source over a deterministic white 4:5 canvas', async () => {
    const foreground = await sharp({ create: { width: 100, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 80, height: 30, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 10, top: 10 }])
      .png()
      .toBuffer();
    const result = await service.composeWhiteBackground(foreground, { width: 800, height: 1000 });
    const image = sharp(result);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(800);
    expect(info.height).toBe(1000);
    const center = ((Math.floor(info.height / 2) * info.width) + Math.floor(info.width / 2)) * info.channels;
    expect(data[center]).toBe(255);
    expect(data[center + 1]).toBeLessThanOrEqual(2);
    expect(data[center + 2]).toBeLessThanOrEqual(2);
  });

  it('produces a lossless deterministic-composite proof for a transparent foreground', async () => {
    const foreground = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 220, g: 30, b: 20, alpha: 0.5 } },
    }).png().toBuffer();

    const result = await service.composeWhiteBackgroundWithProof(foreground, { width: 800, height: 1000 });

    expect((await sharp(result.buffer).metadata()).format).toBe('png');
    expect(result.proof.verified).toBe(true);
    expect(result.proof.protectedPixelCount).toBeGreaterThan(0);
    expect(result.proof.algorithm).toBe('rgba-exact-white-composite-v1');
    const { data, info } = await sharp(result.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const center = ((Math.floor(info.height / 2) * info.width) + Math.floor(info.width / 2)) * info.channels;
    // 220/30/20 at alpha=128 composited against white must remain the exact
    // source-over result rather than a lossy WebP approximation.
    expect([...data.slice(center, center + 4)]).toEqual([237, 142, 137, 255]);
  });
});
