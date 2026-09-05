import { BadRequestException } from '@nestjs/common';
import { UploadController } from './upload.controller';

describe('UploadController managed product-asset boundary', () => {
  const build = () => {
    const upload = {
      uploadFile: jest.fn(),
      uploadFiles: jest.fn(),
      createAccessUrl: jest.fn(),
      getFileForDownload: jest.fn(),
      deleteFile: jest.fn(),
    };
    const productMediaAccess = { assertPublicReadable: jest.fn() };
    return { controller: new UploadController(upload as any, productMediaAccess as any), upload };
  };

  it('does not let the generic upload endpoint write into the managed product-asset namespace', async () => {
    const { controller, upload } = build();

    await expect(controller.uploadFile({} as Express.Multer.File, { folder: 'seller-product-assets' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(upload.uploadFile).not.toHaveBeenCalled();
  });

  it('does not mint generic access or download links for managed product assets', async () => {
    const { controller, upload } = build();

    await expect(controller.getAccessUrl('seller-product-assets/pending.webp')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.downloadFile('seller-product-assets/pending.webp', undefined, {} as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(upload.createAccessUrl).not.toHaveBeenCalled();
    expect(upload.getFileForDownload).not.toHaveBeenCalled();
  });

  it.each([
    ['seller-product-assets\\source.webp'],
    ['seller-product-assets%2Fsource.webp'],
  ])('normalizes a managed key before rejecting generic reads: %s', async (key) => {
    const { controller, upload } = build();
    await expect(controller.getAccessUrl(key)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.downloadFile(key, undefined, {} as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(upload.createAccessUrl).not.toHaveBeenCalled();
    expect(upload.getFileForDownload).not.toHaveBeenCalled();
  });

  it('does not let the generic deletion endpoint remove a managed product asset', async () => {
    const { controller, upload } = build();

    await expect(controller.deleteFile('seller-product-assets/pending.webp')).rejects.toBeInstanceOf(BadRequestException);
    expect(upload.deleteFile).not.toHaveBeenCalled();
  });

  it('normalizes a managed key before rejecting deletion', async () => {
    const { controller, upload } = build();
    await expect(controller.deleteFile('seller-product-assets%2Fsource.webp')).rejects.toBeInstanceOf(BadRequestException);
    expect(upload.deleteFile).not.toHaveBeenCalled();
  });
});
