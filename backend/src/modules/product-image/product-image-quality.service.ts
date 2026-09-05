import { Injectable } from '@nestjs/common';
const sharp = require('sharp') as typeof import('sharp').default;

/**
 * The product card renders media in a 4:5 frame.  These are diagnostics only:
 * they neither generate nor mutate the uploaded image.
 */
export const PRODUCT_IMAGE_QUALITY_THRESHOLDS = {
  minimumPreviewWidth: 800,
  minimumPreviewHeight: 1000,
  targetAspectRatio: 4 / 5,
  darkBrightness: 45,
  brightBrightness: 220,
  lowContrastStandardDeviation: 18,
  maxInputPixels: 40_000_000,
} as const;

export type ImageBrightnessAdvisory = 'TOO_DARK' | 'TOO_BRIGHT' | null;
export type ImageContrastAdvisory = 'LOW_CONTRAST' | null;

export interface ProductImageQualityAdvisory {
  code:
    | 'IMAGE_TOO_SMALL'
    | 'PORTRAIT_CROP_RISK'
    | 'TOO_DARK'
    | 'TOO_BRIGHT'
    | 'LOW_CONTRAST';
  severity: 'warning';
}

export interface ProductImageQualityAnalysis {
  /** Dimensions as the seller will see them after EXIF orientation is applied. */
  width: number;
  height: number;
  aspectRatio: number;
  tooSmall: boolean;
  portraitCropRisk: boolean;
  hasTransparentPixels: boolean;
  brightness: {
    mean: number;
    advisory: ImageBrightnessAdvisory;
  };
  contrast: {
    standardDeviation: number;
    advisory: ImageContrastAdvisory;
  };
  advisories: ProductImageQualityAdvisory[];
}

@Injectable()
export class ProductImageQualityService {
  /**
   * Inspects pixels and metadata only. The input buffer is never transformed,
   * written, or returned, so callers cannot accidentally treat a diagnostic as
   * an optimized image asset.
   */
  async analyze(buffer: Buffer): Promise<ProductImageQualityAnalysis> {
    const source = sharp(buffer, {
      failOn: 'error',
      limitInputPixels: PRODUCT_IMAGE_QUALITY_THRESHOLDS.maxInputPixels,
    });
    const [metadata, stats] = await Promise.all([
      source.metadata(),
      source.stats(),
    ]);

    if (!metadata.width || !metadata.height) {
      throw new Error('Unable to determine image dimensions');
    }

    const isRotated = metadata.orientation !== undefined && metadata.orientation >= 5;
    const width = isRotated ? metadata.height : metadata.width;
    const height = isRotated ? metadata.width : metadata.height;
    const aspectRatio = width / height;
    const previewWidth = Math.min(
      width,
      height * PRODUCT_IMAGE_QUALITY_THRESHOLDS.targetAspectRatio,
    );
    const previewHeight = previewWidth / PRODUCT_IMAGE_QUALITY_THRESHOLDS.targetAspectRatio;
    const tooSmall =
      previewWidth < PRODUCT_IMAGE_QUALITY_THRESHOLDS.minimumPreviewWidth ||
      previewHeight < PRODUCT_IMAGE_QUALITY_THRESHOLDS.minimumPreviewHeight;
    const portraitCropRisk =
      aspectRatio < PRODUCT_IMAGE_QUALITY_THRESHOLDS.targetAspectRatio;

    const brightnessMean = this.round(this.calculateLuminance(stats.channels, 'mean'));
    const contrastStandardDeviation = this.round(
      this.calculateLuminance(stats.channels, 'stdev'),
    );
    const brightnessAdvisory: ImageBrightnessAdvisory =
      brightnessMean < PRODUCT_IMAGE_QUALITY_THRESHOLDS.darkBrightness
        ? 'TOO_DARK'
        : brightnessMean > PRODUCT_IMAGE_QUALITY_THRESHOLDS.brightBrightness
          ? 'TOO_BRIGHT'
          : null;
    const contrastAdvisory: ImageContrastAdvisory =
      contrastStandardDeviation <
      PRODUCT_IMAGE_QUALITY_THRESHOLDS.lowContrastStandardDeviation
        ? 'LOW_CONTRAST'
        : null;

    const advisories: ProductImageQualityAdvisory[] = [];
    if (tooSmall) {
      advisories.push({ code: 'IMAGE_TOO_SMALL', severity: 'warning' });
    }
    if (portraitCropRisk) {
      advisories.push({ code: 'PORTRAIT_CROP_RISK', severity: 'warning' });
    }
    if (brightnessAdvisory) {
      advisories.push({ code: brightnessAdvisory, severity: 'warning' });
    }
    if (contrastAdvisory) {
      advisories.push({ code: contrastAdvisory, severity: 'warning' });
    }

    return {
      width,
      height,
      aspectRatio: this.round(aspectRatio),
      tooSmall,
      portraitCropRisk,
      hasTransparentPixels: metadata.hasAlpha === true && stats.isOpaque === false,
      brightness: {
        mean: brightnessMean,
        advisory: brightnessAdvisory,
      },
      contrast: {
        standardDeviation: contrastStandardDeviation,
        advisory: contrastAdvisory,
      },
      advisories,
    };
  }

  private calculateLuminance(
    channels: Array<{ mean: number; stdev: number }>,
    property: 'mean' | 'stdev',
  ): number {
    if (channels.length === 0) {
      throw new Error('Unable to determine image channel statistics');
    }

    if (channels.length < 3) {
      return channels[0][property];
    }

    return (
      channels[0][property] * 0.2126 +
      channels[1][property] * 0.7152 +
      channels[2][property] * 0.0722
    );
  }

  private round(value: number): number {
    return Number(value.toFixed(2));
  }
}
