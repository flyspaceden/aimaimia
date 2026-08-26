import { BadRequestException, Injectable } from '@nestjs/common';
const sharp = require('sharp') as typeof import('sharp').default;

export type ProductImageCanvas = { width: number; height: number; background?: string };

@Injectable()
export class ProductImageCompositionService {
  /**
   * Deterministic Phase-B renderer. `foreground` must already be a transparent
   * source asset; this method never attempts to infer or redraw a product.
   */
  async composeWhiteBackground(foreground: Buffer, canvas: ProductImageCanvas): Promise<Buffer> {
    if (!Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width < 1 || canvas.height < 1) {
      throw new BadRequestException('合成画布尺寸无效');
    }
    const metadata = await sharp(foreground, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.hasAlpha) {
      throw new BadRequestException('保真白底合成需要透明前景图，不能直接处理完整原图');
    }
    const maxWidth = Math.floor(canvas.width * 0.78);
    const maxHeight = Math.floor(canvas.height * 0.78);
    const rendered = await sharp(foreground, { failOn: 'error', limitInputPixels: 40_000_000 })
      .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    const renderedMetadata = await sharp(rendered).metadata();
    const left = Math.floor((canvas.width - (renderedMetadata.width || 0)) / 2);
    const top = Math.floor((canvas.height - (renderedMetadata.height || 0)) / 2);
    return sharp({ create: { width: canvas.width, height: canvas.height, channels: 4, background: canvas.background || '#ffffff' } })
      .composite([{ input: rendered, left, top }])
      .webp({ quality: 90, effort: 4 })
      .toBuffer();
  }
}
