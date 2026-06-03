import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InvoiceService } from './invoice.service';

describe('InvoiceService request/cancel safety', () => {
  const now = new Date('2026-05-15T12:00:00.000Z');
  let tx: any;
  let prisma: any;
  let adminInvoicesService: any;
  let service: InvoiceService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    tx = {
      order: { findUnique: jest.fn() },
      invoiceProfile: { findUnique: jest.fn() },
      invoice: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      invoiceStatusHistory: { create: jest.fn() },
      ruleConfig: { findUnique: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      invoiceProfile: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      invoice: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    adminInvoicesService = {
      // 默认关闭 autoIssue，避免老用例触发 fire-and-forget 副作用
      getInvoiceSettings: jest.fn().mockResolvedValue({
        providerMode: 'MOCK',
        autoIssue: false,
        autoIssueMaxAttempts: 3,
      }),
      issueInvoice: jest.fn(),
    };
    service = new InvoiceService(prisma, adminInvoicesService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates invoice and status history in a Serializable transaction', async () => {
    tx.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      status: 'RECEIVED',
      bizType: 'NORMAL_GOODS',
      invoice: null,
    });
    tx.invoiceProfile.findUnique.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      type: 'PERSONAL',
      title: '张三',
      taxNo: null,
      email: null,
      phone: null,
      bankInfo: null,
      address: null,
    });
    tx.invoice.create.mockResolvedValue({ id: 'inv-1', status: 'REQUESTED' });

    const invoice = await service.requestInvoice('user-1', {
      orderId: 'order-1',
      profileId: 'profile-1',
    });

    expect(invoice).toEqual({ id: 'inv-1', status: 'REQUESTED' });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(tx.invoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        status: 'REQUESTED',
        requestedAt: now,
        profileSnapshot: expect.objectContaining({ type: 'PERSONAL', title: '张三' }),
      }),
    });
    expect(tx.invoiceStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: 'inv-1',
        fromStatus: null,
        toStatus: 'REQUESTED',
        operatorId: 'user-1',
        operatorType: 'BUYER',
      }),
    });
  });

  it('reuses a canceled invoice row when buyer reapplies', async () => {
    tx.order.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      status: 'RECEIVED',
      bizType: 'NORMAL_GOODS',
      invoice: { id: 'inv-1', status: 'CANCELED', requestCount: 1 },
    });
    tx.invoiceProfile.findUnique.mockResolvedValue({
      id: 'profile-2',
      userId: 'user-1',
      type: 'COMPANY',
      title: '深圳某公司',
      taxNo: '91440300MAEXAMPLE',
      email: 'finance@example.com',
      phone: null,
      bankInfo: null,
      address: null,
    });
    tx.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'REQUESTED', requestCount: 2 });

    const invoice = await service.requestInvoice('user-1', {
      orderId: 'order-1',
      profileId: 'profile-2',
    });

    expect(invoice).toMatchObject({ id: 'inv-1', status: 'REQUESTED' });
    expect(tx.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: expect.objectContaining({
        status: 'REQUESTED',
        invoiceNo: null,
        pdfUrl: null,
        failReason: null,
        provider: null,
        providerRequestId: null,
        providerRaw: Prisma.JsonNull,
        invoiceContentSnapshot: Prisma.JsonNull,
        issuedAt: null,
        failedAt: null,
        canceledAt: null,
        requestedAt: now,
        requestCount: { increment: 1 },
      }),
    });
    expect(tx.invoiceStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: 'inv-1',
        fromStatus: 'CANCELED',
        toStatus: 'REQUESTED',
        operatorType: 'BUYER',
      }),
    });
  });

  it('uses INVOICE_ALLOW_VIP_PACKAGE to control VIP package invoice eligibility', async () => {
    tx.order.findUnique.mockResolvedValue({
      id: 'order-vip',
      userId: 'user-1',
      status: 'RECEIVED',
      bizType: 'VIP_PACKAGE',
      invoice: null,
    });
    tx.ruleConfig.findUnique.mockResolvedValue({
      value: { value: false, description: 'VIP 礼包是否允许申请发票' },
    });

    await expect(
      service.requestInvoice('user-1', { orderId: 'order-vip', profileId: 'profile-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.invoiceProfile.findUnique).not.toHaveBeenCalled();
  });

  it('allows VIP package invoices when INVOICE_ALLOW_VIP_PACKAGE is true', async () => {
    tx.order.findUnique.mockResolvedValue({
      id: 'order-vip',
      userId: 'user-1',
      status: 'RECEIVED',
      bizType: 'VIP_PACKAGE',
      invoice: null,
    });
    tx.ruleConfig.findUnique.mockResolvedValue({
      value: { value: true, description: 'VIP 礼包是否允许申请发票' },
    });
    tx.invoiceProfile.findUnique.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      type: 'PERSONAL',
      title: '张三',
      bankInfo: null,
    });
    tx.invoice.create.mockResolvedValue({ id: 'inv-vip', status: 'REQUESTED' });

    await expect(
      service.requestInvoice('user-1', { orderId: 'order-vip', profileId: 'profile-1' }),
    ).resolves.toMatchObject({ id: 'inv-vip' });
  });

  it('cancels requested invoice with CAS and blocks provider-reserved invoices', async () => {
    tx.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      status: 'REQUESTED',
      order: { userId: 'user-1' },
    });
    tx.invoice.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.cancelInvoice('user-1', 'inv-1')).resolves.toEqual({ ok: true });

    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', status: 'REQUESTED', providerRequestId: null },
      data: { status: 'CANCELED', canceledAt: now },
    });
    expect(tx.invoiceStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: 'inv-1',
        fromStatus: 'REQUESTED',
        toStatus: 'CANCELED',
        operatorId: 'user-1',
        operatorType: 'BUYER',
      }),
    });
  });

  it('returns stable conflict when cancel CAS updates no rows', async () => {
    tx.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      status: 'REQUESTED',
      order: { userId: 'user-1' },
    });
    tx.invoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.cancelInvoice('user-1', 'inv-1')).rejects.toThrow(ConflictException);
  });

  describe('requestInvoice auto-issue trigger', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      // fire-and-forget 用真定时器，避免 setImmediate 被 fake timer 拦住
      jest.useRealTimers();
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // 默认让 requestInvoice 走到 create 成功路径
      tx.order.findUnique.mockResolvedValue({
        id: 'order-1',
        userId: 'user-1',
        status: 'RECEIVED',
        bizType: 'NORMAL_GOODS',
        invoice: null,
      });
      tx.invoiceProfile.findUnique.mockResolvedValue({
        id: 'profile-1',
        userId: 'user-1',
        type: 'PERSONAL',
        title: '张三',
        taxNo: null,
        email: null,
        phone: null,
        bankInfo: null,
        address: null,
      });
      tx.invoice.create.mockResolvedValue({ id: 'inv-auto', status: 'REQUESTED' });
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('fires auto-issue after creating REQUESTED invoice when autoIssue=true', async () => {
      adminInvoicesService.getInvoiceSettings.mockResolvedValue({
        providerMode: 'MOCK',
        autoIssue: true,
        autoIssueMaxAttempts: 3,
      });
      adminInvoicesService.issueInvoice.mockResolvedValue({ ok: true });

      const result = await service.requestInvoice('user-1', {
        orderId: 'order-1',
        profileId: 'profile-1',
      });

      // 释放 Promise.resolve().then(...) 的 microtask
      await new Promise((r) => setImmediate(r));

      expect(adminInvoicesService.getInvoiceSettings).toHaveBeenCalled();
      expect(adminInvoicesService.issueInvoice).toHaveBeenCalledWith(
        result.id,
        { mode: 'MOCK' },
        null,
      );
    });

    it('does not fire auto-issue when autoIssue=false', async () => {
      adminInvoicesService.getInvoiceSettings.mockResolvedValue({
        providerMode: 'MOCK',
        autoIssue: false,
        autoIssueMaxAttempts: 3,
      });

      await service.requestInvoice('user-1', {
        orderId: 'order-1',
        profileId: 'profile-1',
      });
      await new Promise((r) => setImmediate(r));

      expect(adminInvoicesService.issueInvoice).not.toHaveBeenCalled();
    });

    it('does not throw when auto-issue itself fails', async () => {
      adminInvoicesService.getInvoiceSettings.mockResolvedValue({
        providerMode: 'MOCK',
        autoIssue: true,
        autoIssueMaxAttempts: 3,
      });
      adminInvoicesService.issueInvoice.mockRejectedValue(new Error('boom'));

      await expect(
        service.requestInvoice('user-1', { orderId: 'order-1', profileId: 'profile-1' }),
      ).resolves.toBeDefined();
      await new Promise((r) => setImmediate(r));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[auto-issue]'),
        'inv-auto',
        expect.any(Error),
      );
    });
  });
});
