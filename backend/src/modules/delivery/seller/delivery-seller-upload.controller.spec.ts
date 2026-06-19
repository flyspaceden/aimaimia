import { BadRequestException } from '@nestjs/common';
import { UploadService } from '../../upload/upload.service';
import { DeliverySellerUploadController } from './delivery-seller-upload.controller';

describe('DeliverySellerUploadController', () => {
  let uploadService: { uploadFile: jest.Mock };
  let controller: DeliverySellerUploadController;

  beforeEach(() => {
    uploadService = {
      uploadFile: jest.fn().mockResolvedValue({
        url: 'https://example.com/delivery/products/file.webp',
        key: 'delivery/products/file.webp',
        size: 123,
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
});
