import { AfterSaleRefundConsistencyService } from './after-sale-refund-consistency.service';

describe('AfterSaleRefundConsistencyService', () => {
  it('returns mismatches found by the scanner query', async () => {
    const mismatches = [{
      afterSaleId: 'as_001',
      requestRefundId: null,
      refundId: 'refund_001',
      refundAfterSaleId: 'as_001',
    }];
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(mismatches),
    };
    const service = new AfterSaleRefundConsistencyService(prisma as any);

    await expect(service.scan()).resolves.toEqual(mismatches);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('scans request-side refund links even when Refund.afterSaleId is null or missing', async () => {
    const mismatches = [
      {
        afterSaleId: 'as_orphan_refund_link',
        requestRefundId: 'refund_missing_001',
        refundId: null,
        refundAfterSaleId: null,
      },
      {
        afterSaleId: 'as_null_refund_backlink',
        requestRefundId: 'refund_002',
        refundId: 'refund_002',
        refundAfterSaleId: null,
      },
    ];
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(mismatches),
    };
    const service = new AfterSaleRefundConsistencyService(prisma as any);

    await expect(service.scan()).resolves.toEqual(mismatches);

    const [strings] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('')).toContain(
      'a."refundId" IS NOT NULL OR r."afterSaleId" IS NOT NULL',
    );
  });
});
