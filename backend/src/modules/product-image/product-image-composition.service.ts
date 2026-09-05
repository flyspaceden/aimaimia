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
export type ProductImageFreeTuneProof = {
  algorithm: 'pixel-aligned-deterministic-free-tune-v1';
  sourceSha256: string;
  outputSha256: string;
  source: { width: number; height: number };
  output: { width: number; height: number };
  parameters: { brightness: number; contrast: number; saturation: number; sharpenSigma: number };
  geometryIdentity: true;
};

export type ProductImageFreeTuneResult = { buffer: Buffer; proof: ProductImageFreeTuneProof };

@Injectable()
export class ProductImageCompositionService {
  /**
   * The first FREE_TUNE profile deliberately stays small and globally fixed.
   * It changes only photometric values, never dimensions, crop, orientation,
   * object geometry, text content, or source-to-output coordinate mapping.
   */
  async enhanceStandardRealScene(source: Buffer): Promise<ProductImageFreeTuneResult> {
    const parameters = { brightness: 1.025, contrast: 1.015, saturation: 1, sharpenSigma: 0.35 };
    let metadata: import('sharp').Metadata;
    try {
      metadata = await sharp(source, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
    } catch {
      throw new BadRequestException('免费图片增强无法安全解码源图');
    }
    if (!metadata.width || !metadata.height) throw new BadRequestException('免费图片增强缺少源图尺寸');
    if ((metadata.pages ?? 1) > 1) {
      throw new BadRequestException('免费图片增强不支持动画图片，避免将多帧商品事实压缩为静态候选');
    }

    // No rotate/resize/extract/composite operation is permitted in this path.
    const buffer = await sharp(source, { failOn: 'error', limitInputPixels: 40_000_000 })
      .linear(parameters.contrast, (1 - parameters.contrast) * 128)
      .modulate({ brightness: parameters.brightness, saturation: parameters.saturation })
      .sharpen({ sigma: parameters.sharpenSigma, m1: 0, m2: 1 })
      // Preserve the deterministic candidate byte-for-byte after tuning; a
      // later upload normalizer must not silently apply a second lossy pass.
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    const output = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
    if (output.width !== metadata.width || output.height !== metadata.height) {
      throw new BadRequestException('免费图片增强违反了像素对齐约束');
    }
    return {
      buffer,
      proof: {
        algorithm: 'pixel-aligned-deterministic-free-tune-v1',
        sourceSha256: this.sha256(source),
        outputSha256: this.sha256(buffer),
        source: { width: metadata.width, height: metadata.height },
        output: { width: output.width, height: output.height },
        parameters,
        geometryIdentity: true,
      },
    };
  }

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
