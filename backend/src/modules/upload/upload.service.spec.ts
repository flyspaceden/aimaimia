import { NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { UploadService } from './upload.service';

describe('UploadService download files', () => {
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
