import { Prisma } from '@prisma/client';
import { AdminInvoicesService } from './admin-invoices.service';

describe('AdminInvoicesService invoice closure', () => {
  const now = new Date('2026-05-15T12:00:00.000Z');
  let tx: any;
  let prisma: any;
  let provider: any;
  let providerFactory: any;
  let service: AdminInvoicesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    tx = {
      invoice: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        updateMany: jest.fn(),
      },
      invoiceStatusHistory: { create: jest.fn() },
      ruleConfig: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      invoice: {
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        findUnique: jest.fn(),
      },
      ruleConfig: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    provider = {
      issue: jest.fn(),
    };
    providerFactory = {
      resolve: jest.fn(() => provider),
    };
    service = new AdminInvoicesService(prisma, providerFactory);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns default settings when RuleConfig rows are missing', async () => {
    prisma.ruleConfig.findMany.mockResolvedValue([]);

    await expect(service.getInvoiceSettings()).resolves.toMatchObject({
      providerMode: 'MOCK',
      allowVipPackage: false,
      lineMode: 'ORDER_ITEMS',
      defaultTaxRate: 0,
      defaultGoodsName: '农产品',
      issuerProfile: expect.objectContaining({ companyName: '爱买买app' }),
    });
  });

  it('upserts invoice settings using wrapped RuleConfig values', async () => {
    prisma.ruleConfig.upsert.mockResolvedValue({});

    await service.updateInvoiceSettings({
      allowVipPackage: true,
      defaultTaxRate: 0.06,
      issuerProfile: { companyName: '爱买买app', taxNo: '91440300MAEXAMPLE' },
    });

    expect(prisma.ruleConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'INVOICE_ALLOW_VIP_PACKAGE' },
      update: { value: { value: true, description: expect.any(String) } },
      create: { key: 'INVOICE_ALLOW_VIP_PACKAGE', value: { value: true, description: expect.any(String) } },
    });
    expect(prisma.ruleConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'INVOICE_DEFAULT_TAX_RATE' },
      update: { value: { value: 0.06, description: expect.any(String) } },
      create: { key: 'INVOICE_DEFAULT_TAX_RATE', value: { value: 0.06, description: expect.any(String) } },
    });
  });

  it('searches keyword by invoiceNo, order id, and profileSnapshot title', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.invoice.count.mockResolvedValue(0);

    await service.findAll({ keyword: '深圳某公司' } as any);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { invoiceNo: { contains: '深圳某公司' } },
          { order: { id: '深圳某公司' } },
          { profileSnapshot: { path: ['title'], string_contains: '深圳某公司' } },
        ]),
      }),
    }));
  });

  it('issues through mock provider with reservation, idempotency key, snapshot, and history', async () => {
    const invoice = {
      id: 'inv-1',
      status: 'REQUESTED',
      requestCount: 2,
      profileSnapshot: { type: 'COMPANY', title: '深圳某公司', taxNo: '91440300MAEXAMPLE' },
      order: {
        id: 'order-1',
        totalAmount: 100,
        goodsAmount: 92,
        shippingFee: 8,
        paidAt: new Date('2026-05-14T12:00:00.000Z'),
        items: [{
          id: 'item-1',
          quantity: 2,
          unitPrice: 50,
          productSnapshot: { title: '苹果', skuTitle: '5斤装' },
        }],
      },
    };
    tx.invoice.findUnique.mockResolvedValue(invoice);
    tx.ruleConfig.findMany.mockResolvedValue([
      { key: 'INVOICE_PROVIDER_MODE', value: { value: 'MOCK', description: 'Provider' } },
      { key: 'INVOICE_ISSUER_PROFILE', value: { value: { companyName: '爱买买app', taxNo: '9144' }, description: '主体' } },
      { key: 'INVOICE_LINE_MODE', value: { value: 'ORDER_ITEMS', description: '行模式' } },
      { key: 'INVOICE_DEFAULT_TAX_RATE', value: { value: 0, description: '税率' } },
      { key: 'INVOICE_DEFAULT_TAX_CLASSIFICATION_CODE', value: { value: '', description: '编码' } },
      { key: 'INVOICE_REMARK_TEMPLATE', value: { value: '订单号：{{orderId}}', description: '备注' } },
    ]);
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });
    provider.issue.mockResolvedValue({
      invoiceNo: 'MOCK-20260515-0001',
      pdfUrl: 'http://localhost:3000/uploads/invoices/mock/inv.pdf',
      provider: 'MOCK',
      providerRequestId: 'invoice-inv-1-2',
      raw: { ok: true, token: 'must-not-persist' },
    });

    await expect(service.issueInvoice('inv-1', { mode: 'MOCK' }, 'admin-1')).resolves.toEqual({ ok: true });

    expect(provider.issue).toHaveBeenCalledWith(expect.objectContaining({
      invoiceId: 'inv-1',
      providerRequestId: 'invoice-inv-1-2',
      issuerProfile: expect.objectContaining({ companyName: '爱买买app' }),
      lines: [expect.objectContaining({ name: '苹果 5斤装', amount: 100 })],
    }));
    expect(tx.invoice.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'inv-1', status: 'REQUESTED', providerRequestId: null },
      data: { provider: 'MOCK', providerRequestId: 'invoice-inv-1-2' },
    });
    expect(tx.invoice.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'inv-1', status: 'REQUESTED', providerRequestId: 'invoice-inv-1-2' },
      data: expect.objectContaining({
        status: 'ISSUED',
        invoiceNo: 'MOCK-20260515-0001',
        pdfUrl: 'http://localhost:3000/uploads/invoices/mock/inv.pdf',
        provider: 'MOCK',
        providerRaw: { ok: true },
        invoiceContentSnapshot: expect.objectContaining({
          buyer: expect.objectContaining({ title: '深圳某公司' }),
          issuer: expect.objectContaining({ companyName: '爱买买app' }),
        }),
        issuedAt: now,
      }),
    });
    expect(tx.invoiceStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: 'inv-1',
        fromStatus: 'REQUESTED',
        toStatus: 'ISSUED',
        operatorId: 'admin-1',
        operatorType: 'ADMIN',
      }),
    });
  });

  it('marks invoice failed with failedAt and status history', async () => {
    tx.invoice.findUnique.mockResolvedValue({ id: 'inv-1', status: 'REQUESTED' });
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.failInvoice('inv-1', { reason: '税号错误' }, 'admin-1'),
    ).resolves.toEqual({ ok: true, reason: '税号错误' });

    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', status: 'REQUESTED' },
      data: { status: 'FAILED', failReason: '税号错误', failedAt: now },
    });
    expect(tx.invoiceStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: 'inv-1',
        fromStatus: 'REQUESTED',
        toStatus: 'FAILED',
        reason: '税号错误',
        operatorId: 'admin-1',
        operatorType: 'ADMIN',
      }),
    });
  });
});
