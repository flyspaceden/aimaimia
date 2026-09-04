import { NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
const sharp = require('sharp') as typeof import('sharp').default;
import { UploadService } from './upload.service';

describe('UploadService download files', () => {
  it('accepts only PNG for the lossless renderer output path', async () => {
    const service = new UploadService({ get: jest.fn((_key: string, fallback?: string) => fallback) } as any, {} as any);
    const file = { mimetype: 'image/jpeg' } as Express.Multer.File;

    await expect(service.uploadFile(file, 'seller-product-assets', { preserveManagedImage: true })).rejects.toThrow('仅接受 PNG');
  });

  it('does not transcode a lossless renderer PNG before recording its integrity proof', async () => {
    const buffer = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 220, g: 30, b: 20, alpha: 0.5 } },
    }).png().toBuffer();
    const config = { get: jest.fn((key: string, fallback?: string) => key === 'UPLOAD_LOCAL' ? 'false' : fallback) };
    const scanner = {
      scanAndProcess: jest.fn().mockResolvedValue({
        safe: true, needsReview: false, qrCodesDetected: 0, contactInfoDetected: false, processedBuffer: buffer,
      }),
    };
    const service = new UploadService(config as any, scanner as any);
    const normalizeImage = jest.spyOn(service as any, 'normalizeImage');
    const put = jest.fn().mockResolvedValue({ url: 'https://oss.example/candidate.png' });
    jest.spyOn(service as any, 'getOssClient').mockReturnValue({ put, signatureUrl: jest.fn() });

    const result = await service.uploadFile({
      buffer, size: buffer.length, mimetype: 'image/png', originalname: 'candidate.png',
    } as Express.Multer.File, 'seller-product-assets', { preserveManagedImage: true, preserveQrCodes: true });

    expect(normalizeImage).not.toHaveBeenCalled();
    expect(scanner.scanAndProcess).toHaveBeenCalledWith(buffer, { preserveManagedImage: true, preserveQrCodes: true });
    expect(put).toHaveBeenCalledWith(expect.stringMatching(/^seller-product-assets\//), buffer, expect.anything());
    expect(result.mimeType).toBe('image/png');
  });

  it('canonicalizes a product evidence image losslessly before QR scanning', async () => {
    const source = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 220, g: 30, b: 20, alpha: 0.5 } },
    }).png().toBuffer();
    const config = { get: jest.fn((key: string, fallback?: string) => key === 'UPLOAD_LOCAL' ? 'false' : fallback) };
    const scanner = {
      scanAndProcess: jest.fn().mockImplementation(async (buffer: Buffer) => ({
        safe: true, needsReview: false, qrCodesDetected: 0, contactInfoDetected: false, processedBuffer: buffer,
      })),
    };
    const service = new UploadService(config as any, scanner as any);
    const normalizeImage = jest.spyOn(service as any, 'normalizeImage');
    const put = jest.fn().mockResolvedValue({ url: 'https://oss.example/source.webp' });
    jest.spyOn(service as any, 'getOssClient').mockReturnValue({ put, signatureUrl: jest.fn() });

    const result = await service.uploadFile({
      buffer: source, size: source.length, mimetype: 'image/png', originalname: 'source.png',
    } as Express.Multer.File, 'seller-product-assets', { preserveEvidencePixels: true, preserveQrCodes: true });

    const canonical = scanner.scanAndProcess.mock.calls[0][0] as Buffer;
    const [sourceRaw, canonicalRaw] = await Promise.all([
      sharp(source).ensureAlpha().raw().toBuffer(),
      sharp(canonical).ensureAlpha().raw().toBuffer(),
    ]);
    expect(normalizeImage).not.toHaveBeenCalled();
    expect(scanner.scanAndProcess).toHaveBeenCalledWith(canonical, { preserveEvidencePixels: true, preserveQrCodes: true });
    expect(canonicalRaw).toEqual(sourceRaw);
    expect(result.mimeType).toBe('image/webp');
  });

  it('always gives managed product assets a signed local preview URL', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'UPLOAD_LOCAL') return 'true';
        if (key === 'UPLOAD_PRIVATE_BASE_URL') return 'https://api.example/api/v1/upload/private';
        if (key === 'UPLOAD_SIGN_SECRET') return 'test-sign-secret';
        return fallback;
      }),
    };
    const service = new UploadService(config as any, {} as any);

    const access = await service.createPrivateAccessUrl('seller-product-assets/pending.webp', 60);

    expect(access.url).toMatch(/^https:\/\/api\.example\/api\/v1\/upload\/private\/seller-product-assets\/pending\.webp\?expires=\d+&sig=/);
    expect(access.expiresAt).not.toBeNull();
  });

  it('fails at startup before a production local upload can create an orphaned managed asset', () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'UPLOAD_LOCAL') return 'true';
        if (key === 'NODE_ENV') return 'production';
        return fallback;
      }),
    };

    expect(() => new UploadService(config as any, {} as any))
      .toThrow('UPLOAD_SIGN_SECRET');
  });

  it('streams OSS objects when local upload storage is disabled', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'UPLOAD_LOCAL') return 'false';
        return fallback;
      }),
    };
    const service = new UploadService(config as any, {} as any);
    const stream = Readable.from(['file']);
    const getStream = jest.fn().mockResolvedValue({ stream });
    jest.spyOn(service as any, 'getOssClient').mockReturnValue({ getStream });

    const file = await service.getFileForDownload('documents/license.pdf');

    expect(getStream).toHaveBeenCalledWith('documents/license.pdf');
    expect(file).toEqual({
      stream,
      mimeType: 'application/pdf',
      basename: 'license.pdf',
    });
  });

  it('maps a missing OSS object to NotFoundException', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => key === 'UPLOAD_LOCAL' ? 'false' : fallback),
    };
    const service = new UploadService(config as any, {} as any);
    jest.spyOn(service as any, 'getOssClient').mockReturnValue({
      getStream: jest.fn().mockRejectedValue({ code: 'NoSuchKey', statusCode: 404 }),
    });

    await expect(service.getFileForDownload('documents/missing.pdf')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('permits only trusted documents PDFs and images for company report preview', () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'UPLOAD_BASE_URL') return 'https://api.example.com/uploads';
        if (key === 'UPLOAD_PRIVATE_BASE_URL') return 'https://api.example.com/api/v1/upload/private';
        if (key === 'OSS_BUCKET') return 'aimm-assets';
        if (key === 'OSS_REGION') return 'oss-cn-hangzhou';
        return fallback;
      }),
    };
    const service = new UploadService(config as any, {} as any);

    expect(service.canPreviewCompanyDocument('https://api.example.com/uploads/documents/report.pdf')).toBe(true);
    expect(service.canPreviewCompanyDocument('https://api.example.com/api/v1/upload/private/documents/report.webp?sig=x')).toBe(true);
    expect(service.canPreviewCompanyDocument('https://aimm-assets.oss-cn-hangzhou.aliyuncs.com/documents/report.png')).toBe(true);
    expect(service.canPreviewCompanyDocument('https://outside.example/documents/report.pdf')).toBe(false);
    expect(service.canPreviewCompanyDocument('https://api.example.com/uploads/documents/report.mp4')).toBe(false);
    expect(service.canPreviewCompanyDocument('https://api.example.com/uploads/documents/%2E%2E/secret.pdf')).toBe(false);
    expect(service.canPreviewCompanyDocument('https:///documents/report.pdf')).toBe(false);
  });
});
