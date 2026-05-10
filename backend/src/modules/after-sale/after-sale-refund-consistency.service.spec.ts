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
});
