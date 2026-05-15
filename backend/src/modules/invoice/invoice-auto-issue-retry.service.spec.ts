import { Test } from '@nestjs/testing';
import { InvoiceAutoIssueRetryService } from './invoice-auto-issue-retry.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminInvoicesService } from '../admin/invoices/admin-invoices.service';

describe('InvoiceAutoIssueRetryService', () => {
  let service: InvoiceAutoIssueRetryService;
  let prisma: any;
  let adminInvoicesService: any;

  beforeEach(async () => {
    prisma = {
      invoice: {
        findMany: jest.fn(),
      },
    };
    adminInvoicesService = {
      getInvoiceSettings: jest.fn().mockResolvedValue({
        autoIssue: true,
        providerMode: 'MOCK',
        autoIssueMaxAttempts: 3,
      }),
      issueInvoice: jest.fn().mockResolvedValue({ ok: true }),
      markAutoIssueRetryExhausted: jest.fn().mockResolvedValue({ ok: true }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoiceAutoIssueRetryService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminInvoicesService, useValue: adminInvoicesService },
      ],
    }).compile();

    service = moduleRef.get(InvoiceAutoIssueRetryService);
    // Silence logger
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips when autoIssue setting is false', async () => {
    adminInvoicesService.getInvoiceSettings.mockResolvedValue({ autoIssue: false, providerMode: 'MOCK', autoIssueMaxAttempts: 3 });
    await service.handleRetries();
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(adminInvoicesService.issueInvoice).not.toHaveBeenCalled();
  });

  it('queries candidates with correct filter shape', async () => {
    prisma.invoice.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.handleRetries();
    // first call = candidates query
    expect(prisma.invoice.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        status: 'REQUESTED',
        providerRequestId: null,
        failedAttempts: { gt: 0, lt: 3 },
        OR: expect.arrayContaining([
          { lastAutoIssueAttemptAt: null },
          expect.objectContaining({ lastAutoIssueAttemptAt: expect.objectContaining({ lt: expect.any(Date) }) }),
        ]),
      }),
      take: 20,
      orderBy: { lastAutoIssueAttemptAt: 'asc' },
    }));
  });

  it('retries each candidate via issueInvoice(id, {mode}, null)', async () => {
    prisma.invoice.findMany.mockResolvedValueOnce([{ id: 'inv-1' }, { id: 'inv-2' }]).mockResolvedValueOnce([]);
    await service.handleRetries();
    expect(adminInvoicesService.issueInvoice).toHaveBeenCalledTimes(2);
    expect(adminInvoicesService.issueInvoice).toHaveBeenNthCalledWith(1, 'inv-1', { mode: 'MOCK' }, null);
    expect(adminInvoicesService.issueInvoice).toHaveBeenNthCalledWith(2, 'inv-2', { mode: 'MOCK' }, null);
  });

  it('marks exhausted candidates as failed', async () => {
    prisma.invoice.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'inv-3' }, { id: 'inv-4' }]);
    await service.handleRetries();
    expect(adminInvoicesService.markAutoIssueRetryExhausted).toHaveBeenCalledTimes(2);
    expect(adminInvoicesService.markAutoIssueRetryExhausted).toHaveBeenCalledWith('inv-3');
    expect(adminInvoicesService.markAutoIssueRetryExhausted).toHaveBeenCalledWith('inv-4');
  });

  it('continues retrying remaining candidates when one throws', async () => {
    prisma.invoice.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]).mockResolvedValueOnce([]);
    adminInvoicesService.issueInvoice.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ ok: true });
    await service.handleRetries();
    expect(adminInvoicesService.issueInvoice).toHaveBeenCalledTimes(2);
  });

  it('does not throw when settings lookup fails', async () => {
    adminInvoicesService.getInvoiceSettings.mockRejectedValue(new Error('db down'));
    await expect(service.handleRetries()).resolves.toBeUndefined();
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});
