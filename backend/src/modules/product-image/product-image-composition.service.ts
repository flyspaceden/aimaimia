import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
const sharp = require('sharp') as typeof import('sharp').default;

export type ProductImageCanvas = { width: number; height: number; background?: string };
export type ProductImageIntegrityProof = {
  algorithm: 'rgba-exact-white-composite-v1';
  sourceSha256: string;
  transformedForegroundSha256: string;
  outputSha256: string;
  protectedPixelCount: number;
  verified: true;
  geometry: { left: number; top: number; width: number; height: number };
};

export type ProductImageCompositionResult = { buffer: Buffer; proof: ProductImageIntegrityProof };

@Injectable()
export class ProductImageCompositionService {
  /**
   * Deterministic Phase-B renderer. `foreground` must already be a transparent
   * source asset; this method never attempts to infer or redraw a product.
   */
  async composeWhiteBackground(foreground: Buffer, canvas: ProductImageCanvas): Promise<Buffer> {
    return (await this.composeWhiteBackgroundWithProof(foreground, canvas)).buffer;
  }

  async composeWhiteBackgroundWithProof(
    foreground: Buffer,
    canvas: ProductImageCanvas,
  ): Promise<ProductImageCompositionResult> {
    if (!Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width < 1 || canvas.height < 1) {
      throw new BadRequestException('合成画布尺寸无效');
    }
    if (canvas.background !== undefined && canvas.background.toLowerCase() !== '#ffffff') {
      throw new BadRequestException('保真白底合成仅允许纯白画布');
    }
    const metadata = await sharp(foreground, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.hasAlpha) {
      throw new BadRequestException('保真白底合成需要透明前景图，不能直接处理完整原图');
    }
    const rawForeground = await sharp(foreground, { failOn: 'error', limitInputPixels: 40_000_000 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let hasTransparentPixel = false;
    for (let offset = 3; offset < rawForeground.data.length; offset += rawForeground.info.channels) {
      if (rawForeground.data[offset] < 255) {
        hasTransparentPixel = true;
        break;
      }
    }
    if (!hasTransparentPixel) {
      throw new BadRequestException('保真白底合成需要实际透明区域，不能直接处理完整实拍图');
    }
    const maxWidth = Math.floor(canvas.width * 0.78);
    const maxHeight = Math.floor(canvas.height * 0.78);
    const rendered = await sharp(foreground, { failOn: 'error', limitInputPixels: 40_000_000 })
      .ensureAlpha()
      .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true, kernel: 'nearest' })
      .png()
      .toBuffer();
    const renderedMetadata = await sharp(rendered).metadata();
    const left = Math.floor((canvas.width - (renderedMetadata.width || 0)) / 2);
    const top = Math.floor((canvas.height - (renderedMetadata.height || 0)) / 2);
    const output = await sharp({
      create: { width: canvas.width, height: canvas.height, channels: 4, background: canvas.background || '#ffffff' },
    }).composite([{ input: rendered, left, top }]).png().toBuffer();
    const protectedPixelCount = await this.assertForegroundPixelsPreserved(
      rendered,
      output,
      { left, top, width: renderedMetadata.width || 0, height: renderedMetadata.height || 0 },
    );
    return {
      buffer: output,
      proof: {
        algorithm: 'rgba-exact-white-composite-v1',
        sourceSha256: this.sha256(foreground),
        transformedForegroundSha256: this.sha256(rendered),
        outputSha256: this.sha256(output),
        protectedPixelCount,
        verified: true,
        geometry: { left, top, width: renderedMetadata.width || 0, height: renderedMetadata.height || 0 },
      },
    };
  }

  private async assertForegroundPixelsPreserved(
    transformedForeground: Buffer,
    output: Buffer,
    geometry: { left: number; top: number; width: number; height: number },
  ): Promise<number> {
    const [foregroundRaw, outputRaw] = await Promise.all([
      sharp(transformedForeground).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    let protectedPixelCount = 0;
    for (let y = 0; y < foregroundRaw.info.height; y += 1) {
      for (let x = 0; x < foregroundRaw.info.width; x += 1) {
        const sourceOffset = (y * foregroundRaw.info.width + x) * foregroundRaw.info.channels;
        const alpha = foregroundRaw.data[sourceOffset + 3];
        if (alpha === 0) continue;
        protectedPixelCount += 1;
        const outputOffset = ((geometry.top + y) * outputRaw.info.width + geometry.left + x) * outputRaw.info.channels;
        for (let channel = 0; channel < 3; channel += 1) {
          const expected = Math.floor(
            (foregroundRaw.data[sourceOffset + channel] * alpha + 255 * (255 - alpha)) / 255,
          );
          if (outputRaw.data[outputOffset + channel] !== expected) {
            throw new BadRequestException('保真合成校验失败：商品前景像素发生变化');
          }
        }
        if (outputRaw.data[outputOffset + 3] !== 255) {
          throw new BadRequestException('保真合成校验失败：画布透明度异常');
        }
      }
    }
    if (protectedPixelCount === 0) {
      throw new BadRequestException('保真白底合成需要至少一个非透明商品前景像素');
    }
    return protectedPixelCount;
  }

  private sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }
}
