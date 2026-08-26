const sharp = require('sharp') as typeof import('sharp').default;
import { BadRequestException } from '@nestjs/common';
import { ProductImageCompositionService } from './product-image-composition.service';

describe('ProductImageCompositionService', () => {
  const service = new ProductImageCompositionService();

  it('requires a transparent foreground rather than silently redrawing a full image', async () => {
    const source = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ff0000' } }).png().toBuffer();
    await expect(service.composeWhiteBackground(source, { width: 800, height: 1000 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('centers a transparent source over a deterministic white 4:5 canvas', async () => {
    const foreground = await sharp({ create: { width: 100, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
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
});
