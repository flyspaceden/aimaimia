import { DeliveryManifestFormat } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { UploadService } from '../../upload/upload.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryOrdersService } from '../orders/delivery-orders.service';
import { DeliveryManifestsService } from './delivery-manifests.service';

const buildSimplePdfMock = jest.fn(async (lines: string[]) => Buffer.from(`%PDF-1.7\n${lines.join('\n')}`));
const buildSpreadsheetXmlMock = jest.fn((headers: string[], rows: string[][]) =>
  Buffer.from(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<headers>${headers.join('|')}</headers>`,
      ...rows.map((row) => `<row>${row.join('|')}</row>`),
    ].join('\n'),
    'utf8',
  ),
);

jest.mock('./delivery-manifest.renderers', () => ({
  buildSimplePdf: (...args: unknown[]) => buildSimplePdfMock(...(args as [string[]])),
  buildSpreadsheetXml: (...args: unknown[]) =>
    buildSpreadsheetXmlMock(...(args as [string[], string[][]])),
}));

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
      },
    ],
  };

  beforeEach(() => {
    buildSimplePdfMock.mockClear();
    buildSpreadsheetXmlMock.mockClear();
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
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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
    const uploadedPdf = uploadService.uploadBuffer.mock.calls[0][0] as Buffer;
    expect(uploadedPdf.toString('latin1', 0, 8)).toMatch(/^%PDF-1\./);
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

  it('preserves Chinese text in buyer PDFs and renders buyer columns from normalized template config', async () => {
    const localizedOrderContext = {
      ...orderContext,
      unitName: '清河厨房',
      recipientName: '张三',
      detailAddress: '南山区科技园一层',
      items: [
        {
          ...orderContext.items[0],
          merchantName: '北仓商户',
          productTitle: '牛肉',
          skuTitle: '精品装',
        },
      ],
    };
    deliveryOrdersService.getOrderManifestContextForBuyer.mockResolvedValue(localizedOrderContext);
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
      id: 'ver_buyer_full_v2',
      templateId: 'tmpl_buyer_full',
      versionNo: 2,
      status: 'PUBLISHED',
      config: {
        columns: [
          { key: 'recipientName', label: '收货人', sortOrder: 5, visible: true, fixed: true },
          { key: 'orderId', label: '配送单号', sortOrder: 10, visible: true, fixed: true },
          { key: 'merchantName', label: '商户', sortOrder: 15, visible: false, fixed: false },
          { key: 'productTitle', label: '商品名称', sortOrder: 20, visible: true, fixed: true },
          { key: 'finalLineAmount', label: '金额', sortOrder: 25, visible: true, fixed: true },
        ],
      },
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(version);
    deliveryPrisma.deliveryManifest.findFirst.mockResolvedValue(null);
    deliveryPrisma.deliveryManifest.create.mockImplementation(({ data }: any) => data);

    const manifest = await service.getOrderManifest({
      orderId: 'PSDD0000000000001',
      viewer: { kind: 'buyer', deliveryUserId: 'delivery_user_1' },
    });

    const uploadedPdf = uploadService.uploadBuffer.mock.calls[0][0] as Buffer;
    expect(uploadedPdf.toString('latin1', 0, 8)).toMatch(/^%PDF-1\./);
    expect(manifest.payloadSnapshot.renderedTable.headers).toEqual([
      '收货人',
      '配送单号',
      '商品名称',
      'Unit',
      '金额',
      'Recipient Phone',
      'Address',
      'SKU',
      'Qty',
      'Final Unit Price',
      'Paid At',
      'Note',
      'Goods Amount',
      'Shipping Fee',
      'Total Amount',
    ]);
    expect(manifest.payloadSnapshot.renderedTable.rows[0]).toEqual([
      '张三',
      'PSDD0000000000001',
      '牛肉',
      '清河厨房',
      '176.00',
      '13800000002',
      '南山区科技园一层',
      '精品装',
      '2',
      '88.00',
      '2026-06-19T09:30:00.000Z',
      'Call before arrival',
      '176.00',
      '5.00',
      '181.00',
    ]);
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

    const uploadedPdf = uploadService.uploadBuffer.mock.calls[0][0] as Buffer;
    expect(uploadedPdf.toString('latin1', 0, 8)).toMatch(/^%PDF-1\./);
    expect(manifest.type).toBe('SELLER_FULFILLMENT');
    expect(manifest.payloadSnapshot.columns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'finalUnitPrice' }),
        expect.objectContaining({ key: 'supplyAmount' }),
      ]),
    );
  });

  it('renders seller fulfillment PDFs from normalized visible columns and keeps fixed columns non-hideable', async () => {
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
      id: 'ver_seller_fulfillment_v2',
      templateId: 'tmpl_seller_fulfillment',
      versionNo: 2,
      status: 'PUBLISHED',
      config: {
        columns: [
          { key: 'recipientName', label: '收件人', sortOrder: 5, visible: true, fixed: true },
          { key: 'orderId', label: '配送主单', sortOrder: 10, visible: false, fixed: true },
          { key: 'subOrderId', label: '子单号', sortOrder: 15, visible: true, fixed: true },
          { key: 'note', label: '备注', sortOrder: 20, visible: false, fixed: false },
          { key: 'productTitle', label: '商品', sortOrder: 25, visible: true, fixed: true },
        ],
      },
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(version);
    deliveryPrisma.deliveryManifest.findFirst.mockResolvedValue(null);
    deliveryPrisma.deliveryManifest.create.mockImplementation(({ data }: any) => data);

    const manifest = await service.getSellerFulfillmentManifest('merchant_1', 'PSZDD000000000001');

    const uploadedPdf = uploadService.uploadBuffer.mock.calls[0][0] as Buffer;
    expect(uploadedPdf.toString('latin1', 0, 8)).toMatch(/^%PDF-1\./);
    expect(manifest.payloadSnapshot.renderedTable.headers).toEqual([
      '收件人',
      '配送主单',
      '子单号',
      '商品',
      'Unit',
      'Recipient Phone',
      'Address',
      'SKU',
      'Item Unit',
      'Qty',
      'Paid At',
    ]);
    expect(manifest.payloadSnapshot.renderedTable.rows[0]).toEqual([
      'Receiver A',
      'PSDD0000000000001',
      'PSZDD000000000001',
      'Beef',
      'Qinghe Kitchen',
      '13800000002',
      'Science Park 1F',
      '5kg Box',
      'box',
      '2',
      '2026-06-19T09:30:00.000Z',
    ]);
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
    expect(uploadedSheet).not.toContain('|5.00|');
    expect(uploadedSheet).not.toContain('Shipping Share');
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
        expect.objectContaining({ key: 'shippingFeeShare' }),
      ]),
    );
    expect(manifest.payloadSnapshot.rows[0]).toEqual(
      expect.objectContaining({
        supplyAmount: '120.00',
        settlementAmount: '125.00',
      }),
    );
    expect(manifest.payloadSnapshot.rows[0]).not.toHaveProperty('shippingFeeShare');
  });

  it('creates a fresh seller finance export when finance rows change under the same template version', async () => {
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
    deliveryPrisma.deliveryManifest.create.mockImplementation(({ data }: any) => data);
    deliveryOrdersService.getSellerFinanceExportContext
      .mockResolvedValueOnce(financeContext)
      .mockResolvedValueOnce({
        ...financeContext,
        rows: [
          ...financeContext.rows,
          {
            subOrderId: 'PSZDD000000000002',
            orderId: 'PSDD0000000000002',
            paidAt: new Date('2026-06-19T10:30:00.000Z'),
            itemSummary: 'Pork x1',
            quantity: 1,
            supplyAmountCents: 5400,
            shippingFeeShareCents: 200,
            settlementAmountCents: 5600,
          },
        ],
      });
    deliveryIdService.next
      .mockResolvedValueOnce('PSQD0000000000001')
      .mockResolvedValueOnce('PSQD0000000000002');
    uploadService.uploadBuffer.mockResolvedValue({
      url: 'https://oss.example.com/delivery/manifests/file.xls',
      key: 'delivery/manifests/file.xls',
      size: 256,
      mimeType: 'application/vnd.ms-excel',
    });

    const first = await service.exportSellerFinanceManifest('merchant_1');
    const second = await service.exportSellerFinanceManifest('merchant_1');

    expect(first.id).toBe('PSQD0000000000001');
    expect(second.id).toBe('PSQD0000000000002');
    expect(uploadService.uploadBuffer).toHaveBeenCalledTimes(2);
    expect(uploadService.uploadBuffer.mock.calls[1][0].toString('utf8')).toContain(
      'PSZDD000000000002',
    );
    expect(second.payloadSnapshot.rows).toHaveLength(2);
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

  it('supports per-order custom columns and values so buyer manifests can be regenerated with extra fields', async () => {
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
      id: 'ver_buyer_full_v2',
      templateId: 'tmpl_buyer_full',
      versionNo: 2,
      status: 'PUBLISHED',
      config: null,
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockImplementation(async () => template);
    deliveryPrisma.deliveryManifestTemplate.update.mockImplementation(({ data }: any) => {
      Object.assign(template, data);
      return template;
    });
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(version);
    deliveryPrisma.deliveryManifest.findFirst.mockResolvedValue(null);
    deliveryPrisma.deliveryManifest.updateMany.mockResolvedValue({ count: 0 });
    deliveryPrisma.deliveryManifest.create.mockImplementation(({ data }: any) => data);

    await service.upsertTargetCustomization('admin_1', {
      manifestType: 'BUYER_FULL',
      targetId: 'PSDD0000000000001',
      entries: [
        {
          key: 'pickupCode',
          label: '取货码',
          value: 'A-17',
          sortOrder: 17,
          visible: true,
        },
      ],
    });

    const manifest = await service.getOrderManifest({
      orderId: 'PSDD0000000000001',
      viewer: { kind: 'admin', deliveryAdminUserId: 'admin_1' },
    });

    expect(manifest.payloadSnapshot.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'pickupCode',
          label: '取货码',
          visible: true,
        }),
      ]),
    );
    expect(manifest.payloadSnapshot.rows[0]).toEqual(
      expect.objectContaining({
        pickupCode: 'A-17',
      }),
    );
    expect(manifest.payloadSnapshot.renderedTable.headers).toContain('取货码');
    expect(manifest.payloadSnapshot.renderedTable.rows[0]).toContain('A-17');
  });

  it('rejects seller fulfillment custom columns whose keys or labels reveal sensitive money fields', async () => {
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
      id: 'ver_seller_fulfillment_v2',
      templateId: 'tmpl_seller_fulfillment',
      versionNo: 2,
      status: 'PUBLISHED',
      config: null,
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(version);

    await expect(
      service.upsertTargetCustomization('admin_1', {
        manifestType: 'SELLER_FULFILLMENT',
        targetId: 'PSZDD000000000001',
        entries: [
          {
            key: 'shippingFee',
            label: '运费金额',
            value: '5.00',
            visible: true,
          },
        ],
      }),
    ).rejects.toThrow('卖家配货清单禁止自定义金额相关字段');
  });

  it('rejects seller fulfillment custom values that reveal money or pricing information', async () => {
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
      id: 'ver_seller_fulfillment_v3',
      templateId: 'tmpl_seller_fulfillment',
      versionNo: 3,
      status: 'PUBLISHED',
      config: null,
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(version);

    for (const value of ['¥100', '平台售价 100', '成本 60', '运费到付']) {
      await expect(
        service.upsertTargetCustomization('admin_1', {
          manifestType: 'SELLER_FULFILLMENT',
          targetId: 'PSZDD000000000001',
          entries: [
            {
              key: 'memo',
              label: '履约备注',
              value,
              visible: true,
            },
          ],
        }),
      ).rejects.toThrow('卖家配货清单禁止自定义金额相关字段');
    }
  });

  it('allows ordinary seller fulfillment remarks and does not apply the seller rule to buyer full manifests', async () => {
    const sellerTemplate = {
      id: 'tmpl_seller_fulfillment',
      type: 'SELLER_FULFILLMENT',
      name: 'Seller Fulfillment',
      description: null,
      config: null,
      isDefault: true,
      isActive: true,
    };
    const sellerVersion = {
      id: 'ver_seller_fulfillment_v4',
      templateId: 'tmpl_seller_fulfillment',
      versionNo: 4,
      status: 'PUBLISHED',
      config: null,
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(sellerTemplate);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(sellerVersion);
    deliveryPrisma.deliveryManifestTemplate.update.mockResolvedValue(sellerTemplate);
    deliveryPrisma.deliveryManifest.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.upsertTargetCustomization('admin_1', {
        manifestType: 'SELLER_FULFILLMENT',
        targetId: 'PSZDD000000000001',
        entries: [
          {
            key: 'memo',
            label: '履约备注',
            value: '请冷藏保存，优先上午配送',
            visible: true,
          },
        ],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        entries: [expect.objectContaining({ value: '请冷藏保存，优先上午配送' })],
      }),
    );

    const buyerTemplate = {
      id: 'tmpl_buyer_full',
      type: 'USER_FULL',
      name: 'Buyer Full',
      description: null,
      config: null,
      isDefault: true,
      isActive: true,
    };
    const buyerVersion = {
      id: 'ver_buyer_full_v1',
      templateId: 'tmpl_buyer_full',
      versionNo: 1,
      status: 'PUBLISHED',
      config: null,
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(buyerTemplate);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(buyerVersion);
    deliveryPrisma.deliveryManifestTemplate.update.mockResolvedValue(buyerTemplate);

    await expect(
      service.upsertTargetCustomization('admin_1', {
        manifestType: 'BUYER_FULL',
        targetId: 'PSDD0000000000001',
        entries: [
          {
            key: 'memo',
            label: '付款备注',
            value: '平台售价 ¥100',
            visible: true,
          },
        ],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        manifestType: 'BUYER_FULL',
      }),
    );
  });

  it('filters persisted dirty seller fulfillment customizations from generated payloads while keeping ordinary remarks', async () => {
    const template = {
      id: 'tmpl_seller_fulfillment',
      type: 'SELLER_FULFILLMENT',
      name: 'Seller Fulfillment',
      description: null,
      config: {
        customizations: {
          subOrder: {
            PSZDD000000000001: {
              targetId: 'PSZDD000000000001',
              entries: [
                {
                  key: 'sellerMemo',
                  label: '配货备注',
                  value: '请冷藏保存，优先上午配送',
                  sortOrder: 500,
                  visible: true,
                },
                {
                  key: 'platformPrice',
                  label: '平台售价',
                  value: '¥100',
                  sortOrder: 510,
                  visible: true,
                },
                {
                  key: 'costInfo',
                  label: '履约说明',
                  value: '成本 60',
                  sortOrder: 520,
                  visible: true,
                },
              ],
            },
          },
        },
      },
      isDefault: true,
      isActive: true,
    };
    const version = {
      id: 'ver_seller_fulfillment_v5',
      templateId: 'tmpl_seller_fulfillment',
      versionNo: 5,
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

    expect(manifest.payloadSnapshot.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'sellerMemo', label: '配货备注' })]),
    );
    expect(manifest.payloadSnapshot.columns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'platformPrice' }),
        expect.objectContaining({ key: 'costInfo' }),
      ]),
    );
    expect(manifest.payloadSnapshot.rows[0]).toEqual(
      expect.objectContaining({
        sellerMemo: '请冷藏保存，优先上午配送',
      }),
    );
    expect(manifest.payloadSnapshot.rows[0]).not.toHaveProperty('platformPrice');
    expect(manifest.payloadSnapshot.rows[0]).not.toHaveProperty('costInfo');
    expect(manifest.payloadSnapshot.renderedTable.headers).toContain('配货备注');
    expect(manifest.payloadSnapshot.renderedTable.headers).not.toContain('平台售价');
    expect(manifest.payloadSnapshot.renderedTable.rows[0]).toContain('请冷藏保存，优先上午配送');
    expect(manifest.payloadSnapshot.renderedTable.rows[0]).not.toContain('¥100');
    expect(manifest.payloadSnapshot.renderedTable.rows[0]).not.toContain('成本 60');
  });

  it('keeps persisted buyer full customizations even when they contain price-related wording', async () => {
    const template = {
      id: 'tmpl_buyer_full',
      type: 'USER_FULL',
      name: 'Buyer Full',
      description: null,
      config: {
        customizations: {
          order: {
            PSDD0000000000001: {
              targetId: 'PSDD0000000000001',
              entries: [
                {
                  key: 'buyerMemo',
                  label: '付款备注',
                  value: '平台售价 ¥100',
                  sortOrder: 500,
                  visible: true,
                },
              ],
            },
          },
        },
      },
      isDefault: true,
      isActive: true,
    };
    const version = {
      id: 'ver_buyer_full_v2',
      templateId: 'tmpl_buyer_full',
      versionNo: 2,
      status: 'PUBLISHED',
      config: null,
      createdByAdminId: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    };
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(version);
    deliveryPrisma.deliveryManifest.findFirst.mockResolvedValue(null);
    deliveryPrisma.deliveryManifest.create.mockImplementation(({ data }: any) => data);

    const manifest = await service.getOrderManifest({
      orderId: 'PSDD0000000000001',
      viewer: { kind: 'admin', deliveryAdminUserId: 'admin_1' },
    });

    expect(manifest.payloadSnapshot.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'buyerMemo', label: '付款备注' })]),
    );
    expect(manifest.payloadSnapshot.rows[0]).toEqual(
      expect.objectContaining({
        buyerMemo: '平台售价 ¥100',
      }),
    );
    expect(manifest.payloadSnapshot.renderedTable.headers).toContain('付款备注');
    expect(manifest.payloadSnapshot.renderedTable.rows[0]).toContain('平台售价 ¥100');
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

  it('paginates large buyer manifests so rows beyond the first page still reach the PDF output', async () => {
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
    const largeOrderContext = {
      ...orderContext,
      items: Array.from({ length: 50 }, (_, index) => ({
        ...orderContext.items[0],
        subOrderId: `PSZDD000000000${String(index + 1).padStart(3, '0')}`,
        productTitle: `商品${index + 1}`,
        skuTitle: `规格${index + 1}`,
      })),
    };
    deliveryOrdersService.getOrderManifestContextForBuyer.mockResolvedValue(largeOrderContext);
    deliveryPrisma.deliveryManifestTemplate.findFirst.mockResolvedValue(template);
    deliveryPrisma.deliveryManifestVersion.findFirst.mockResolvedValue(version);
    deliveryPrisma.deliveryManifest.findFirst.mockResolvedValue(null);
    deliveryPrisma.deliveryManifest.create.mockImplementation(({ data }: any) => data);

    const manifest = await service.getOrderManifest({
      orderId: 'PSDD0000000000001',
      viewer: { kind: 'buyer', deliveryUserId: 'delivery_user_1' },
    });

    expect(buildSimplePdfMock).toHaveBeenCalled();
    const renderedLines = buildSimplePdfMock.mock.calls.at(-1)?.[0] ?? [];
    expect(renderedLines.some((line: string) => line.includes('商品1'))).toBe(true);
    expect(renderedLines.some((line: string) => line.includes('商品50'))).toBe(true);
    expect(manifest.payloadSnapshot.rows).toHaveLength(50);
    expect(manifest.payloadSnapshot.renderedTable.rows).toHaveLength(50);
    expect(manifest.payloadSnapshot.renderedTable.rows[0]).toContain('商品1');
    expect(manifest.payloadSnapshot.renderedTable.rows[49]).toContain('商品50');
  });
});
