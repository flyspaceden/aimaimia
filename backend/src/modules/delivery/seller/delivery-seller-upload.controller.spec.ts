import { BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { UploadService } from '../../upload/upload.service';
import { DeliverySellerUploadController } from './delivery-seller-upload.controller';

describe('DeliverySellerUploadController', () => {
  let uploadService: {
    uploadFile: jest.Mock;
    getFileForDownload: jest.Mock;
    getSignedLocalFile: jest.Mock;
  };
  let controller: DeliverySellerUploadController;

  beforeEach(() => {
    uploadService = {
      uploadFile: jest.fn().mockResolvedValue({
        url: 'https://example.com/delivery/products/file.webp',
        key: 'delivery/products/file.webp',
        size: 123,
        mimeType: 'image/webp',
      }),
      getFileForDownload: jest.fn().mockResolvedValue({
        filePath: '/tmp/delivery/products/file.webp',
        mimeType: 'image/webp',
        basename: 'file.webp',
      }),
      getSignedLocalFile: jest.fn().mockReturnValue({
        filePath: '/tmp/delivery/products/private-file.webp',
        mimeType: 'image/webp',
      }),
    };
    controller = new DeliverySellerUploadController(uploadService as unknown as UploadService);
  });

  it('forces uploads into the delivery namespace even when the frontend asks for products', async () => {
    const file = {
      originalname: 'demo.png',
      mimetype: 'image/png',
      size: 12,
      buffer: Buffer.from('demo'),
    } as Express.Multer.File;

    await controller.uploadFile(file, { folder: 'products' });

    expect(uploadService.uploadFile).toHaveBeenCalledWith(file, 'delivery/products');
  });

  it('uses the delivery products folder when the frontend omits folder hints', async () => {
    const file = {
      originalname: 'demo.png',
      mimetype: 'image/png',
      size: 12,
      buffer: Buffer.from('demo'),
    } as Express.Multer.File;

    await controller.uploadFile(file, {});

    expect(uploadService.uploadFile).toHaveBeenCalledWith(file, 'delivery/products');
  });

  it('rejects empty uploads before reaching the shared upload service', async () => {
    await expect(controller.uploadFile(undefined as never, { folder: 'products' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(uploadService.uploadFile).not.toHaveBeenCalled();
  });

  it('routes delivery downloads through the delivery-seller upload namespace with attachment headers', async () => {
    const res = createResponseDouble();

    await controller.downloadFile('delivery/products/file.webp', '配送商品图.webp', res);

    expect(uploadService.getFileForDownload).toHaveBeenCalledWith('delivery/products/file.webp');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="_____.webp"; filename*=UTF-8''${encodeURIComponent('配送商品图.webp')}`,
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=60');
    expect(res.sendFile).toHaveBeenCalledWith('/tmp/delivery/products/file.webp');
  });

  it('adds content-disposition for private delivery downloads when download mode is requested', () => {
    const res = createResponseDouble();

    controller.getPrivateFile(
      'delivery/products/private-file.webp',
      '123',
      'signed',
      '1',
      '私有图.webp',
      res,
    );

    expect(uploadService.getSignedLocalFile).toHaveBeenCalledWith('delivery/products/private-file.webp', '123', 'signed');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="___.webp"; filename*=UTF-8''${encodeURIComponent('私有图.webp')}`,
    );
    expect(res.sendFile).toHaveBeenCalledWith('/tmp/delivery/products/private-file.webp');
  });
});

function createResponseDouble(): Response {
  const res = {
    setHeader: jest.fn(),
    sendFile: jest.fn(),
  };
  return res as unknown as Response;
}
