import { DeliveryManifestFormat } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { UploadService } from '../../upload/upload.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryOrdersService } from '../orders/delivery-orders.service';
import { DeliveryManifestsService } from './delivery-manifests.service';

describe('DeliveryManifestsService', () => {
  let deliveryPrisma: any;
  let deliveryOrdersService: any;
  let deliveryIdService: { next: jest.Mock };
  let uploadService: { uploadBuffer: jest.Mock; deleteFile: jest.Mock };
  let service: DeliveryManifestsService;

  const orderContext = {
    orderId: 'PSDD0000000000001',
    userId: 'delivery_user_1',
    unitId: 'unit_1',
    unitName: 'Qinghe Kitchen',
    contactName: 'Kitchen Buyer',
    contactPhone: '13800000001',
    recipientName: 'Receiver A',
    recipientPhone: '13800000002',
    regionText: 'Guangdong Shenzhen Nanshan',
    detailAddress: 'Science Park 1F',
    note: 'Call before arrival',
    goodsAmountCents: 17600,
    shippingFeeCents: 500,
    totalAmountCents: 18100,
    paidAt: new Date('2026-06-19T09:30:00.000Z'),
    items: [
      {
        subOrderId: 'PSZDD000000000001',
        merchantId: 'merchant_1',
        merchantName: 'Warehouse North',
        productTitle: 'Beef',
        skuTitle: '5kg Box',
        unitName: 'box',
        quantity: 2,
        finalUnitPriceCents: 8800,
        finalLineAmountCents: 17600,
        supplyUnitPriceCents: 6000,
        supplyAmountCents: 12000,
        shippingFeeShareCents: 500,
      },
    ],
    payments: [
      {
        merchantOrderNo: 'PSZF0000000000001',
        channel: 'ALIPAY',
        amountCents: 18100,
        paidAt: new Date('2026-06-19T09:30:00.000Z'),
      },
    ],
  };

  const fulfillmentContext = {
    subOrderId: 'PSZDD000000000001',
    orderId: 'PSDD0000000000001',
    merchantId: 'merchant_1',
    merchantName: 'Warehouse North',
    unitName: 'Qinghe Kitchen',
    contactName: 'Kitchen Buyer',
    contactPhone: '13800000001',
    recipientName: 'Receiver A',
    recipientPhone: '13800000002',
    regionText: 'Guangdong Shenzhen Nanshan',
    detailAddress: 'Science Park 1F',
    note: 'Call before arrival',
    paidAt: new Date('2026-06-19T09:30:00.000Z'),
    items: [
      {
        productTitle: 'Beef',
        skuTitle: '5kg Box',
        unitName: 'box',
        quantity: 2,
        finalUnitPriceCents: 8800,
        finalLineAmountCents: 17600,
        supplyUnitPriceCents: 6000,
        supplyAmountCents: 12000,
      },
    ],
  };

  const financeContext = {
    merchantId: 'merchant_1',
    merchantName: 'Warehouse North',
    rows: [
      {
        subOrderId: 'PSZDD000000000001',
        orderId: 'PSDD0000000000001',
        paidAt: new Date('2026-06-19T09:30:00.000Z'),
        itemSummary: 'Beef x2',
        quantity: 2,
        supplyAmountCents: 12000,
        shippingFeeShareCents: 500,
        settlementAmountCents: 12500,
        buyerFinalAmountCents: 17600,
      },
    ],
  };

  beforeEach(() => {
    deliveryPrisma = {
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(deliveryPrisma)),
      deliveryManifestTemplate: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        create: jest.fn(),
      },
      deliveryManifestVersion: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      deliveryManifest: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    deliveryOrdersService = {
      getOrderManifestContextForBuyer: jest.fn().mockResolvedValue(orderContext),
      getOrderManifestContextForAdmin: jest.fn().mockResolvedValue(orderContext),
      getSellerFulfillmentManifestContext: jest.fn().mockResolvedValue(fulfillmentContext),
      getSellerFinanceExportContext: jest.fn().mockResolvedValue(financeContext),
    };

    deliveryIdService = {
      next: jest.fn().mockResolvedValue('PSQD0000000000001'),
    };

    uploadService = {
      uploadBuffer: jest.fn().mockResolvedValue({
        url: 'https://oss.example.com/delivery/manifests/file.pdf',
        key: 'delivery/manifests/file.pdf',
        size: 128,
        mimeType: 'application/pdf',
      }),
      deleteFile: jest.fn(),
    };

    service = new DeliveryManifestsService(
      deliveryPrisma as DeliveryPrismaService,
      deliveryOrdersService as DeliveryOrdersService,
      deliveryIdService as unknown as DeliveryIdService,
      uploadService as unknown as UploadService,
    );
  });

  it('lets buyers and admins generate full manifests that include final prices and uploads under the delivery/manifests prefix', async () => {
    const template = {
      id: 'tmpl_buyer_full',
      type: 'USER_FULL',
      name: 'Buyer Full',
      description: null,
      config: null,
      isDefault: true,
      isActive: true,
    };
    const version = {
      id: 'ver_buyer_full_v1',
      templateId: 'tmpl_buyer_full',
      versionNo: 1,
      status: 'PUBLISHED',
      config: null,
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(version);
    deliveryPrisma.deliveryManifest.findFirst.mockResolvedValue(null);
    deliveryPrisma.deliveryManifest.create.mockImplementation(({ data }: any) => data);

    const buyerResult = await service.getOrderManifest({
      orderId: 'PSDD0000000000001',
      viewer: { kind: 'buyer', deliveryUserId: 'delivery_user_1' },
    });
    const adminResult = await service.getOrderManifest({
      orderId: 'PSDD0000000000001',
      viewer: { kind: 'admin', deliveryAdminUserId: 'admin_1' },
    });

    expect(deliveryOrdersService.getOrderManifestContextForBuyer).toHaveBeenCalledWith(
      'delivery_user_1',
      'PSDD0000000000001',
    );
    expect(deliveryOrdersService.getOrderManifestContextForAdmin).toHaveBeenCalledWith(
      'PSDD0000000000001',
    );
    expect(uploadService.uploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^delivery\/manifests\//),
      '.pdf',
      'application/pdf',
    );
    const uploadedPdf = uploadService.uploadBuffer.mock.calls[0][0].toString('latin1');
    expect(uploadedPdf).toContain('88.00');
    expect(uploadedPdf).toContain('176.00');
    expect(buyerResult.type).toBe('BUYER_FULL');
    expect(adminResult.type).toBe('BUYER_FULL');
    expect(buyerResult.format).toBe(DeliveryManifestFormat.PDF);
    expect(buyerResult.payloadSnapshot.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'finalUnitPrice', visible: true }),
        expect.objectContaining({ key: 'finalLineAmount', visible: true }),
      ]),
    );
  });

  it('builds seller fulfillment PDFs without amount fields', async () => {
    const template = {
      id: 'tmpl_seller_fulfillment',
      type: 'SELLER_FULFILLMENT',
      name: 'Seller Fulfillment',
      description: null,
      config: null,
      isDefault: true,
      isActive: true,
    };
    const version = {
      id: 'ver_seller_fulfillment_v1',
      templateId: 'tmpl_seller_fulfillment',
      versionNo: 1,
      status: 'PUBLISHED',
      config: null,
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(version);
    deliveryPrisma.deliveryManifest.findFirst.mockResolvedValue(null);
    deliveryPrisma.deliveryManifest.create.mockImplementation(({ data }: any) => data);

    const manifest = await service.getSellerFulfillmentManifest('merchant_1', 'PSZDD000000000001');

    const uploadedPdf = uploadService.uploadBuffer.mock.calls[0][0].toString('latin1');
    expect(uploadedPdf).toContain('PSZDD000000000001');
    expect(uploadedPdf).toContain('Receiver A');
    expect(uploadedPdf).not.toContain('88.00');
    expect(uploadedPdf).not.toContain('176.00');
    expect(uploadedPdf).not.toContain('120.00');
    expect(manifest.type).toBe('SELLER_FULFILLMENT');
    expect(manifest.payloadSnapshot.columns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'finalUnitPrice' }),
        expect.objectContaining({ key: 'supplyAmount' }),
      ]),
    );
  });

  it('exports seller finance data with only supply and settlement amounts', async () => {
    const template = {
      id: 'tmpl_seller_finance',
      type: 'SELLER_SETTLEMENT',
      name: 'Seller Finance',
      description: null,
      config: null,
      isDefault: true,
      isActive: true,
    };
    const version = {
      id: 'ver_seller_finance_v1',
      templateId: 'tmpl_seller_finance',
      versionNo: 1,
      status: 'PUBLISHED',
      config: null,
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(version);
    deliveryPrisma.deliveryManifest.findFirst.mockResolvedValue(null);
    deliveryPrisma.deliveryManifest.create.mockImplementation(({ data }: any) => data);
    uploadService.uploadBuffer.mockResolvedValue({
      url: 'https://oss.example.com/delivery/manifests/file.xls',
      key: 'delivery/manifests/file.xls',
      size: 256,
      mimeType: 'application/vnd.ms-excel',
    });

    const manifest = await service.exportSellerFinanceManifest('merchant_1');

    expect(uploadService.uploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/^delivery\/manifests\//),
      '.xls',
      'application/vnd.ms-excel',
    );
    const uploadedSheet = uploadService.uploadBuffer.mock.calls[0][0].toString('utf8');
    expect(uploadedSheet).toContain('120.00');
    expect(uploadedSheet).toContain('125.00');
    expect(uploadedSheet).not.toContain('176.00');
    expect(manifest.type).toBe('SELLER_FINANCE');
    expect(manifest.payloadSnapshot.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'supplyAmount', visible: true }),
        expect.objectContaining({ key: 'settlementAmount', visible: true }),
      ]),
    );
    expect(manifest.payloadSnapshot.columns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'buyerFinalAmount' }),
      ]),
    );
  });

  it('protects fixed columns while still supporting column names, order, and visibility for template regeneration', async () => {
    const template = {
      id: 'tmpl_seller_fulfillment',
      type: 'SELLER_FULFILLMENT',
      name: 'Seller Fulfillment',
      description: null,
      config: {
        columns: [
          { key: 'orderId', label: 'Order ID', sortOrder: 10, visible: true, fixed: true },
        ],
      },
      isDefault: true,
      isActive: true,
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestTemplate.update.mockImplementation(({ data }: any) => ({
      ...template,
      ...data,
    }));
    deliveryPrisma.deliveryManifestVersion.findMany
      .mockResolvedValueOnce([{ id: 'ver1', versionNo: 1, status: 'PUBLISHED' }]);
    deliveryPrisma.deliveryManifestVersion.create.mockImplementation(({ data }: any) => data);

    const regenerated = await service.regenerateTemplate('admin_1', 'tmpl_seller_fulfillment', {
      columns: [
        { key: 'orderId', label: 'Delivery Order', sortOrder: 90, visible: false },
        { key: 'note', label: 'Delivery Note', sortOrder: 15, visible: false },
      ],
    });

    expect(deliveryPrisma.deliveryManifestVersion.updateMany).toHaveBeenCalledWith({
      where: { templateId: 'tmpl_seller_fulfillment', status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    });
    expect(regenerated.versionNo).toBe(2);
    expect(regenerated.config.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'orderId',
          label: 'Delivery Order',
          sortOrder: 90,
          visible: true,
          fixed: true,
        }),
        expect.objectContaining({
          key: 'note',
          label: 'Delivery Note',
          sortOrder: 15,
          visible: false,
          fixed: false,
        }),
      ]),
    );
  });

  it('creates v2 and v3 manifests without deleting historical objects when a newer template version is published', async () => {
    const template = {
      id: 'tmpl_buyer_full',
      type: 'USER_FULL',
      name: 'Buyer Full',
      description: null,
      config: null,
      isDefault: true,
      isActive: true,
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestVersion.findFirst
      .mockResolvedValueOnce({
        id: 'ver_buyer_full_v2',
        templateId: 'tmpl_buyer_full',
        versionNo: 2,
        status: 'PUBLISHED',
        config: null,
      })
      .mockResolvedValueOnce({
        id: 'ver_buyer_full_v3',
        templateId: 'tmpl_buyer_full',
        versionNo: 3,
        status: 'PUBLISHED',
        config: null,
      });
    deliveryPrisma.deliveryManifest.findFirst
      .mockResolvedValueOnce({
        id: 'PSQD0000000000009',
        orderId: 'PSDD0000000000001',
        templateVersionId: 'ver_buyer_full_v1',
        type: 'USER_FULL',
        format: 'PDF',
        storageKey: 'delivery/manifests/buyer-v1.pdf',
        fileUrl: 'https://oss.example.com/delivery/manifests/buyer-v1.pdf',
        payloadSnapshot: { versionNo: 1 },
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    deliveryPrisma.deliveryManifest.create.mockImplementation(({ data }: any) => data);
    deliveryIdService.next
      .mockResolvedValueOnce('PSQD0000000000010')
      .mockResolvedValueOnce('PSQD0000000000011');

    const manifestV2 = await service.getOrderManifest({
      orderId: 'PSDD0000000000001',
      viewer: { kind: 'buyer', deliveryUserId: 'delivery_user_1' },
    });
    const manifestV3 = await service.getOrderManifest({
      orderId: 'PSDD0000000000001',
      viewer: { kind: 'buyer', deliveryUserId: 'delivery_user_1' },
    });

    expect(manifestV2.templateVersion.versionNo).toBe(2);
    expect(manifestV3.templateVersion.versionNo).toBe(3);
    expect(manifestV2.id).toBe('PSQD0000000000010');
    expect(manifestV3.id).toBe('PSQD0000000000011');
    expect(uploadService.deleteFile).not.toHaveBeenCalled();
  });
});
