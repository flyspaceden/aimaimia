import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { UPLOAD_MAX_FILE_SIZE } from '../upload/upload.constants';
import { VisualProviderOutput } from './providers/visual-image-edit.provider';
const sharp = require('sharp') as typeof import('sharp').default;

const MAX_PROVIDER_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_PROVIDER_OUTPUT_PIXELS = 40_000_000;
const MAX_CONCURRENT_NORMALIZATIONS = 1;
const MAX_PENDING_NORMALIZATIONS = 8;
const LOSSY_QUALITIES = [95, 88, 82] as const;

export type VisualAgentManagedOutput = {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/webp';
  audit: {
    version: 'visual-agent-managed-output-v1';
    normalization: 'provider-png-preserved-v1' | 'provider-webp-preserved-v1' | 'lossless-webp-v1' | `webp-q${number}-v1`;
    providerSha256: string;
    providerMimeType: VisualProviderOutput['mimeType'];
    providerByteSize: number;
    providerWidth: number;
    providerHeight: number;
    managedSha256: string;
    managedMimeType: 'image/png' | 'image/webp';
    managedByteSize: number;
    managedWidth: number;
    managedHeight: number;
  };
};

@Injectable()
export class VisualAgentManagedOutputService {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  async normalize(output: VisualProviderOutput): Promise<VisualAgentManagedOutput> {
    await this.acquire();
    try {
      return await this.normalizeWithSlot(output);
    } finally {
      this.release();
    }
  }

  private async normalizeWithSlot(output: VisualProviderOutput): Promise<VisualAgentManagedOutput> {
    if (!Buffer.isBuffer(output.buffer) || output.buffer.length === 0 || output.buffer.length > MAX_PROVIDER_OUTPUT_BYTES) {
      throw new ServiceUnavailableException('百炼图片输出大小不满足受管候选要求');
    }
    let providerMeta: import('sharp').Metadata;
    try {
      providerMeta = await sharp(output.buffer, { failOn: 'error', limitInputPixels: MAX_PROVIDER_OUTPUT_PIXELS }).metadata();
    } catch {
      throw new ServiceUnavailableException('百炼图片输出无法安全解码');
    }
    const providerMimeType = this.mimeType(providerMeta.format);
    if (providerMimeType !== output.mimeType || !providerMeta.width || !providerMeta.height) {
      throw new ServiceUnavailableException('百炼图片输出的格式或尺寸不一致');
    }

    if (output.buffer.length <= UPLOAD_MAX_FILE_SIZE && (output.mimeType === 'image/png' || output.mimeType === 'image/webp')) {
      return this.result(output, output.buffer, output.mimeType, providerMeta, output.mimeType === 'image/png'
        ? 'provider-png-preserved-v1'
        : 'provider-webp-preserved-v1');
    }

    const lossless = await this.encodeWebp(output.buffer, { lossless: true, effort: 4 });
    if (lossless.length <= UPLOAD_MAX_FILE_SIZE) {
      return this.result(output, lossless, 'image/webp', providerMeta, 'lossless-webp-v1');
    }
    for (const quality of LOSSY_QUALITIES) {
      const compressed = await this.encodeWebp(output.buffer, { quality, effort: 4 });
      if (compressed.length <= UPLOAD_MAX_FILE_SIZE) {
        return this.result(output, compressed, 'image/webp', providerMeta, `webp-q${quality}-v1`);
      }
    }
    throw new ServiceUnavailableException('百炼图片输出在保持商品展示质量的前提下仍超过 10MB');
  }

  private async encodeWebp(buffer: Buffer, options: import('sharp').WebpOptions) {
    try {
      return await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_PROVIDER_OUTPUT_PIXELS })
        .rotate()
        .webp(options)
        .toBuffer();
    } catch {
      throw new ServiceUnavailableException('百炼图片输出无法安全规范化为商品候选');
    }
  }

  private async result(
    provider: VisualProviderOutput,
    buffer: Buffer,
    mimeType: 'image/png' | 'image/webp',
    providerMeta: import('sharp').Metadata,
    normalization: VisualAgentManagedOutput['audit']['normalization'],
  ): Promise<VisualAgentManagedOutput> {
    let managedMeta: import('sharp').Metadata;
    try {
      managedMeta = await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_PROVIDER_OUTPUT_PIXELS }).metadata();
    } catch {
      throw new ServiceUnavailableException('规范化后的百炼图片无法安全解码');
    }
    if (!managedMeta.width || !managedMeta.height || this.mimeType(managedMeta.format) !== mimeType
      || managedMeta.width !== providerMeta.width || managedMeta.height !== providerMeta.height) {
      throw new ServiceUnavailableException('规范化后的百炼图片尺寸或格式发生异常');
    }
    return {
      buffer,
      mimeType,
      audit: {
        version: 'visual-agent-managed-output-v1',
        normalization,
        providerSha256: this.sha256(provider.buffer),
        providerMimeType: provider.mimeType,
        providerByteSize: provider.buffer.length,
        providerWidth: providerMeta.width!,
        providerHeight: providerMeta.height!,
        managedSha256: this.sha256(buffer),
        managedMimeType: mimeType,
        managedByteSize: buffer.length,
        managedWidth: managedMeta.width,
        managedHeight: managedMeta.height,
      },
    };
  }

  private mimeType(format: string | undefined): VisualProviderOutput['mimeType'] | null {
    if (format === 'jpeg') return 'image/jpeg';
    if (format === 'png') return 'image/png';
    if (format === 'webp') return 'image/webp';
    return null;
  }

  private sha256(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private async acquire() {
    if (this.active < MAX_CONCURRENT_NORMALIZATIONS) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= MAX_PENDING_NORMALIZATIONS) {
      throw new ServiceUnavailableException('图片候选规范化队列繁忙，请稍后恢复同一模型任务');
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }
}
