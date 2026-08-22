import { NotFoundException } from '@nestjs/common';
import { TraceService } from './trace.service';

const event = {
  id: 'trace-event-1',
  type: 'PLANTING',
  data: {},
  occurredAt: new Date('2026-08-01T00:00:00.000Z'),
};

const batch = {
  id: 'batch-1',
  batchCode: 'BATCH-001',
  companyId: 'company-1',
  company: { id: 'company-1', name: '可见企业' },
  meta: {},
  ownershipClaim: null,
  events: [event],
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

describe('TraceService public buyer visibility', () => {
  it('loads a visible product and its visible-company batches in one query', async () => {
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'product-1',
          title: '有机苹果',
          productTraceLinks: [{ note: '首批', batch }],
        }),
      },
    };
    const service = new TraceService(prisma as any);

    await expect(service.getProductTrace('product-1')).resolves.toMatchObject({
      productId: 'product-1',
      productTitle: '有机苹果',
      batches: [{ id: 'batch-1', companyId: 'company-1' }],
    });
    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'product-1',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        company: { status: 'ACTIVE', isPlatform: false },
      },
      select: expect.objectContaining({
        productTraceLinks: expect.objectContaining({
          where: {
            batch: { company: { status: 'ACTIVE', isPlatform: false } },
          },
        }),
      }),
    }));
  });

  it('returns not found instead of exposing an inactive or unapproved product title', async () => {
    const prisma = { product: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new TraceService(prisma as any);

    await expect(service.getProductTrace('product-hidden')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['id', 'getBatchDetail', 'batch-1'],
    ['batchCode', 'getBatchByCode', 'BATCH-001'],
  ] as const)('filters public batch lookup by %s through visible company and product', async (
    lookupField,
    method,
    value,
  ) => {
    const prisma = { traceBatch: { findFirst: jest.fn().mockResolvedValue(batch) } };
    const service = new TraceService(prisma as any);

    await (service[method] as (input: string) => Promise<unknown>)(value);

    expect(prisma.traceBatch.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        [lookupField]: value,
        company: { status: 'ACTIVE', isPlatform: false },
        productTraceLinks: {
          some: {
            product: {
              status: 'ACTIVE',
              auditStatus: 'APPROVED',
              company: { status: 'ACTIVE', isPlatform: false },
            },
          },
        },
      },
    }));
  });
});
