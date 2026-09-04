import { randomBytes } from 'node:crypto';
import { UPLOAD_MAX_FILE_SIZE } from '../upload/upload.constants';
import { VisualAgentManagedOutputService } from './visual-agent-managed-output.service';
const sharp = require('sharp') as typeof import('sharp').default;

describe('VisualAgentManagedOutputService', () => {
  const service = new VisualAgentManagedOutputService();

  it('preserves a safe Provider PNG and records immutable audit hashes and dimensions', async () => {
    const buffer = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#aa3322' } }).png().toBuffer();
    const result = await service.normalize({ buffer, mimeType: 'image/png' });
    expect(result.buffer).toEqual(buffer);
    expect(result.audit).toMatchObject({
      normalization: 'provider-png-preserved-v1', providerMimeType: 'image/png', providerWidth: 320, providerHeight: 240,
      managedMimeType: 'image/png', managedWidth: 320, managedHeight: 240,
    });
    expect(result.audit.providerSha256).toBe(result.audit.managedSha256);
  });

  it('losslessly normalizes an oversized compressible Provider PNG below 10MB', async () => {
    const buffer = await sharp({ create: { width: 2100, height: 2100, channels: 3, background: '#bb3322' } })
      .png({ compressionLevel: 0 }).toBuffer();
    expect(buffer.length).toBeGreaterThan(UPLOAD_MAX_FILE_SIZE);
    const result = await service.normalize({ buffer, mimeType: 'image/png' });
    expect(result.mimeType).toBe('image/webp');
    expect(result.buffer.length).toBeLessThanOrEqual(UPLOAD_MAX_FILE_SIZE);
    expect(result.audit.normalization).toBe('lossless-webp-v1');
    expect(result.audit.providerSha256).not.toBe(result.audit.managedSha256);
    expect(result.audit.managedWidth).toBe(2100);
    expect(result.audit.managedHeight).toBe(2100);
  });

  it('uses a bounded high-quality WebP fallback for a high-entropy oversized image', async () => {
    const width = 2050;
    const height = 2050;
    const buffer = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 0 }).toBuffer();
    expect(buffer.length).toBeGreaterThan(UPLOAD_MAX_FILE_SIZE);
    const result = await service.normalize({ buffer, mimeType: 'image/png' });
    expect(result.mimeType).toBe('image/webp');
    expect(result.buffer.length).toBeLessThanOrEqual(UPLOAD_MAX_FILE_SIZE);
    expect(result.audit.normalization).toMatch(/^webp-q(95|88|82)-v1$/);
    expect(result.audit.managedWidth).toBe(width);
    expect(result.audit.managedHeight).toBe(height);
  });

  it('normalizes a Provider JPEG into the same managed WebP contract', async () => {
    const buffer = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#448866' } }).jpeg({ quality: 95 }).toBuffer();
    const result = await service.normalize({ buffer, mimeType: 'image/jpeg' });
    expect(result.mimeType).toBe('image/webp');
    expect(result.audit.normalization).toBe('lossless-webp-v1');
    expect(result.audit.providerMimeType).toBe('image/jpeg');
  });

  it('rejects MIME spoofing before candidate storage', async () => {
    const buffer = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#448866' } }).png().toBuffer();
    await expect(service.normalize({ buffer, mimeType: 'image/jpeg' })).rejects.toThrow('格式或尺寸不一致');
  });

  it('serializes concurrent normalization work through one shared native-image slot', async () => {
    const isolated = new VisualAgentManagedOutputService();
    let running = 0;
    let peak = 0;
    const output = { buffer: Buffer.from('test'), mimeType: 'image/png' as const };
    jest.spyOn(isolated as any, 'normalizeWithSlot').mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return { buffer: output.buffer, mimeType: 'image/png', audit: {} };
    });

    await Promise.all([isolated.normalize(output), isolated.normalize(output), isolated.normalize(output)]);
    expect(peak).toBe(1);
  });

  it('fails closed when the bounded normalization wait queue is full', async () => {
    const isolated = new VisualAgentManagedOutputService();
    const output = { buffer: Buffer.from('test'), mimeType: 'image/png' as const };
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    jest.spyOn(isolated as any, 'normalizeWithSlot').mockImplementation(async () => {
      await gate;
      return { buffer: output.buffer, mimeType: 'image/png', audit: {} };
    });

    const active = isolated.normalize(output);
    await Promise.resolve();
    const queued = Array.from({ length: 8 }, () => isolated.normalize(output));
    await expect(isolated.normalize(output)).rejects.toThrow('规范化队列繁忙');
    releaseFirst();
    await Promise.all([active, ...queued]);
  });
});
