import { createHash } from 'node:crypto';
const sharp = require('sharp') as typeof import('sharp').default;
import { VisualProviderServerPlan, VisualProviderSource } from './providers/visual-image-edit.provider';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_NORMALIZED_PIXELS = 64_000_000;
const MIN_EDGE = 240;
const MAX_EDGE = 8000;

/**
 * `normalized-rgba-srgb-v1` from the Core design: apply EXIF orientation,
 * convert to sRGB, remove metadata by using raw pixels, and hash fixed
 * big-endian width/height followed by unpremultiplied RGBA bytes.
 */
export async function normalizedSourceSha256(source: VisualProviderSource): Promise<string> {
  if (!Buffer.isBuffer(source.buffer) || source.buffer.length === 0 || source.buffer.length > MAX_SOURCE_BYTES
    || source.normalizedVersion !== 'normalized-rgba-srgb-v1' || source.opaque !== true) {
    throw new Error('视觉源图未满足规范化输入边界');
  }
  const image = sharp(source.buffer, { failOn: 'error', limitInputPixels: MAX_NORMALIZED_PIXELS });
  const metadata = await image.metadata();
  const actualMimeType = metadata.format === 'jpeg' ? 'image/jpeg'
    : metadata.format === 'png' ? 'image/png'
      : metadata.format === 'webp' ? 'image/webp' : undefined;
  if (!actualMimeType || actualMimeType !== source.mimeType || !metadata.width || !metadata.height
    || metadata.width < MIN_EDGE || metadata.height < MIN_EDGE || metadata.width > MAX_EDGE || metadata.height > MAX_EDGE
    || metadata.width / metadata.height > 8 || metadata.height / metadata.width > 8
    || (source.mimeType !== 'image/jpeg' && metadata.hasAlpha)) {
    throw new Error('视觉源图未满足 Provider 输入边界');
  }
  const { data, info } = await image
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width <= 0 || info.height <= 0 || info.channels !== 4) {
    throw new Error('视觉源图无法规范化为 RGBA');
  }
  const header = Buffer.alloc(8);
  header.writeUInt32BE(info.width, 0);
  header.writeUInt32BE(info.height, 4);
  return createHash('sha256').update(header).update(data).digest('hex');
}

/**
 * Plan identity binds every reviewed field, including the protected-region
 * version. The Provider may not interpolate this metadata into its prompt.
 */
export function visualPlanSha256(plan: VisualProviderServerPlan): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(plan.protectedRegionVersion)) {
    throw new Error('受保护区版本不合法');
  }
  const canonical = JSON.stringify({
    templateVersion: plan.templateVersion,
    direction: plan.direction,
    riskProfile: plan.riskProfile,
    allowedOperations: [...plan.allowedOperations].sort(),
    protectedRegionVersion: plan.protectedRegionVersion,
    presentationPreset: plan.presentationPreset ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
