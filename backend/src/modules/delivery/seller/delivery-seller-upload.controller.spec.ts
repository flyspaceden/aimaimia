import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { UploadService } from '../../upload/upload.service';
import { DeliverySellerUploadController } from './delivery-seller-upload.controller';

function sellerUser(overrides: Partial<{ merchantId: string; role: string; permissionCodes: string[] }> = {}) {
  return {
    type: 'delivery-seller',
    merchantId: overrides.merchantId ?? 'merchant_1',
    role: overrides.role ?? 'MANAGER',
    permissionCodes: overrides.permissionCodes ?? ['products:read', 'orders:read', 'finance:read', 'company:read'],
  };
}

describe('DeliverySellerUploadController', () => {
  let uploadService: {
    uploadFile: jest.Mock;
    getFileForDownload: jest.Mock;
    getSignedLocalFile: jest.Mock;
  };
  let deliveryPrisma: any;
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
    deliveryPrisma = {
      deliveryProduct: { findMany: jest.fn().mockResolvedValue([]) },
      deliveryProductSku: { count: jest.fn().mockResolvedValue(1) },
      deliveryManifest: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      deliveryShipment: { count: jest.fn().mockResolvedValue(0) },
      deliverySettlement: { count: jest.fn().mockResolvedValue(0) },
      deliveryMerchantApplication: { count: jest.fn().mockResolvedValue(0) },
    };
    controller = new DeliverySellerUploadController(
      uploadService as unknown as UploadService,
      deliveryPrisma as DeliveryPrismaService,
    );
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

    await (controller as any).downloadFile(sellerUser(), 'delivery/products/file.webp', '配送商品图.webp', res);

    expect(deliveryPrisma.deliveryProductSku.count).toHaveBeenCalledWith({
      where: {
        product: { merchantId: 'merchant_1' },
        imageUrl: { contains: 'delivery/products/file.webp' },
      },
    });
    expect(uploadService.getFileForDownload).toHaveBeenCalledWith('delivery/products/file.webp');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="_____.webp"; filename*=UTF-8''${encodeURIComponent('配送商品图.webp')}`,
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=60');
    expect(res.sendFile).toHaveBeenCalledWith('/tmp/delivery/products/file.webp');
  });

  it('rejects non-delivery download keys before reaching the shared upload service', async () => {
    const res = createResponseDouble();

    await expect(
      (controller as any).downloadFile(sellerUser(), 'documents/file.webp', '配送商品图.webp', res),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(uploadService.getFileForDownload).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('rejects delivery downloads when the file key is not owned by the current merchant', async () => {
    const res = createResponseDouble();
    deliveryPrisma.deliveryProductSku.count.mockResolvedValue(0);
    deliveryPrisma.deliveryProduct.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryManifest.count.mockResolvedValue(0);
    deliveryPrisma.deliveryShipment.count.mockResolvedValue(0);
    deliveryPrisma.deliverySettlement.count.mockResolvedValue(0);
    deliveryPrisma.deliveryMerchantApplication.count.mockResolvedValue(0);

    await expect(
      (controller as any).downloadFile(sellerUser(), 'delivery/products/other.webp', '别人的文件.webp', res),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(uploadService.getFileForDownload).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('allows delivery product media downloads owned by the current merchant', async () => {
    const res = createResponseDouble();
    deliveryPrisma.deliveryProductSku.count.mockResolvedValue(0);
    deliveryPrisma.deliveryProduct.findMany.mockResolvedValue([
      {
        media: [
          {
            url: 'https://example.com/delivery/products/main.webp',
          },
        ],
      },
    ]);

    await (controller as any).downloadFile(sellerUser(), 'delivery/products/main.webp', '商品主图.webp', res);

    expect(uploadService.getFileForDownload).toHaveBeenCalledWith('delivery/products/main.webp');
    expect(res.sendFile).toHaveBeenCalledWith('/tmp/delivery/products/file.webp');
  });

  it('adds content-disposition for private delivery downloads when download mode is requested', async () => {
    const res = createResponseDouble();
    deliveryPrisma.deliveryProductSku.count.mockResolvedValue(1);
    deliveryPrisma.deliveryProduct.findMany.mockResolvedValue([]);

    await (controller as any).getPrivateFile(
      sellerUser(),
      'delivery/products/private-file.webp',
      '123',
      'signed',
      '1',
      '私有图.webp',
      res,
    );

    expect(deliveryPrisma.deliveryProductSku.count).toHaveBeenCalledWith({
      where: {
        product: { merchantId: 'merchant_1' },
        imageUrl: { contains: 'delivery/products/private-file.webp' },
      },
    });
    expect(uploadService.getSignedLocalFile).toHaveBeenCalledWith('delivery/products/private-file.webp', '123', 'signed');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="___.webp"; filename*=UTF-8''${encodeURIComponent('私有图.webp')}`,
    );
    expect(res.sendFile).toHaveBeenCalledWith('/tmp/delivery/products/private-file.webp');
  });

  it('rejects non-delivery private keys before reaching the shared upload service', async () => {
    const res = createResponseDouble();

    await expect(
      (controller as any).getPrivateFile(sellerUser(), 'documents/private-file.webp', '123', 'signed', '1', '私有图.webp', res),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(uploadService.getSignedLocalFile).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('rejects private delivery downloads when the file key is not owned by the current merchant', async () => {
    const res = createResponseDouble();
    deliveryPrisma.deliveryProductSku.count.mockResolvedValue(0);
    deliveryPrisma.deliveryProduct.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryManifest.count.mockResolvedValue(0);
    deliveryPrisma.deliveryShipment.count.mockResolvedValue(0);
    deliveryPrisma.deliverySettlement.count.mockResolvedValue(0);
    deliveryPrisma.deliveryMerchantApplication.count.mockResolvedValue(0);

    await expect(
      (controller as any).getPrivateFile(
        sellerUser(),
        'delivery/products/other-private.webp',
        '123',
        'signed',
        '1',
        '私有图.webp',
        res,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(uploadService.getSignedLocalFile).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('rejects seller finance downloads for staff without finance permission even when the file belongs to the merchant', async () => {
    const res = createResponseDouble();
    deliveryPrisma.deliveryProductSku.count.mockResolvedValue(0);
    deliveryPrisma.deliveryManifest.findFirst.mockResolvedValue({
      type: 'SELLER_SETTLEMENT',
      storageKey: 'delivery/manifests/seller-finance/export.xls',
    });

    await expect(
      (controller as any).downloadFile(
        sellerUser({ permissionCodes: ['orders:read'] }),
        'delivery/manifests/seller-finance/export.xls',
        '配送财务清单.xls',
        res,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(uploadService.getFileForDownload).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('allows seller finance downloads for staff with finance permission', async () => {
    const res = createResponseDouble();
    deliveryPrisma.deliveryProductSku.count.mockResolvedValue(0);
    deliveryPrisma.deliveryManifest.findFirst.mockResolvedValue({
      type: 'SELLER_SETTLEMENT',
      storageKey: 'delivery/manifests/seller-finance/export.xls',
    });
    uploadService.getFileForDownload.mockResolvedValue({
      filePath: '/tmp/delivery/manifests/seller-finance/export.xls',
      mimeType: 'application/vnd.ms-excel',
      basename: 'export.xls',
    });

    await (controller as any).downloadFile(
      sellerUser({ permissionCodes: ['finance:read'] }),
      'delivery/manifests/seller-finance/export.xls',
      '配送财务清单.xls',
      res,
    );

    expect(uploadService.getFileForDownload).toHaveBeenCalledWith('delivery/manifests/seller-finance/export.xls');
    expect(res.sendFile).toHaveBeenCalledWith('/tmp/delivery/manifests/seller-finance/export.xls');
  });
});

function createResponseDouble(): Response {
  const res = {
    setHeader: jest.fn(),
    sendFile: jest.fn(),
  };
  return res as unknown as Response;
}
