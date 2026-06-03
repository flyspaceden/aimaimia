import { Readable } from 'stream';
import { UploadService } from './upload.service';

describe('UploadService download files', () => {
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
});
