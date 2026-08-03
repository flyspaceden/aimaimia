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
      deliveryProductSku: {
        findMany: jest.fn().mockResolvedValue([
          { imageUrl: 'https://example.com/delivery/products/file.webp' },
        ]),
      },
      deliveryManifest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      deliveryShipment: { findMany: jest.fn().mockResolvedValue([]) },
      deliveryCarrierOrder: { findMany: jest.fn().mockResolvedValue([]) },
      deliverySettlement: { findMany: jest.fn().mockResolvedValue([]) },
      deliveryMerchantApplication: { findMany: jest.fn().mockResolvedValue([]) },
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

    expect(deliveryPrisma.deliveryProductSku.findMany).toHaveBeenCalledWith({
      where: {
        product: { merchantId: 'merchant_1' },
        imageUrl: { contains: 'delivery/products/file.webp' },
      },
      select: { imageUrl: true },
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
    deliveryPrisma.deliveryProductSku.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryProduct.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryManifest.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryShipment.findMany.mockResolvedValue([]);
    deliveryPrisma.deliverySettlement.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryMerchantApplication.findMany.mockResolvedValue([]);

    await expect(
      (controller as any).downloadFile(sellerUser(), 'delivery/products/other.webp', '别人的文件.webp', res),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(uploadService.getFileForDownload).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('does not treat a partial delivery key as proof of file ownership', async () => {
    const res = createResponseDouble();
    deliveryPrisma.deliveryProductSku.findMany.mockResolvedValue([
      { imageUrl: 'https://example.com/delivery/products/file.webp' },
    ]);

    await expect(
      (controller as any).downloadFile(
        sellerUser(),
        'delivery/products/file',
        '非完整文件.webp',
        res,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(uploadService.getFileForDownload).not.toHaveBeenCalled();
  });

  it('allows delivery product media downloads owned by the current merchant', async () => {
    const res = createResponseDouble();
    deliveryPrisma.deliveryProductSku.findMany.mockResolvedValue([]);
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

  it('allows the owning seller to download a pickup batch SF waybill', async () => {
    const res = createResponseDouble();
    deliveryPrisma.deliveryProductSku.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryCarrierOrder.findMany.mockResolvedValue([
      { waybillUrl: 'https://example.com/delivery/pickup-waybills/batch.pdf' },
    ]);
    uploadService.getFileForDownload.mockResolvedValue({
      filePath: '/tmp/delivery/pickup-waybills/batch.pdf',
      mimeType: 'application/pdf',
      basename: 'batch.pdf',
    });

    await (controller as any).downloadFile(
      sellerUser({ permissionCodes: ['orders:read'] }),
      'delivery/pickup-waybills/batch.pdf',
      '顺丰面单.pdf',
      res,
    );

    expect(deliveryPrisma.deliveryCarrierOrder.findMany).toHaveBeenCalledWith({
      where: {
        batch: { merchantId: 'merchant_1' },
        waybillUrl: { contains: 'delivery/pickup-waybills/batch.pdf' },
      },
      select: { waybillUrl: true },
    });
    expect(uploadService.getFileForDownload).toHaveBeenCalledWith('delivery/pickup-waybills/batch.pdf');
  });

  it('adds content-disposition for private delivery downloads when download mode is requested', async () => {
    const res = createResponseDouble();
    deliveryPrisma.deliveryProductSku.findMany.mockResolvedValue([
      { imageUrl: 'https://example.com/delivery/products/private-file.webp' },
    ]);
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

    expect(deliveryPrisma.deliveryProductSku.findMany).toHaveBeenCalledWith({
      where: {
        product: { merchantId: 'merchant_1' },
        imageUrl: { contains: 'delivery/products/private-file.webp' },
      },
      select: { imageUrl: true },
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
    deliveryPrisma.deliveryProductSku.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryProduct.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryManifest.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryShipment.findMany.mockResolvedValue([]);
    deliveryPrisma.deliverySettlement.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryMerchantApplication.findMany.mockResolvedValue([]);

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
    deliveryPrisma.deliveryProductSku.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryManifest.findMany.mockResolvedValue([{
      type: 'SELLER_SETTLEMENT',
      storageKey: 'delivery/manifests/seller-finance/export.xls',
      fileUrl: null,
    }]);

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
    deliveryPrisma.deliveryProductSku.findMany.mockResolvedValue([]);
    deliveryPrisma.deliveryManifest.findMany.mockResolvedValue([{
      type: 'SELLER_SETTLEMENT',
      storageKey: 'delivery/manifests/seller-finance/export.xls',
      fileUrl: null,
    }]);
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
