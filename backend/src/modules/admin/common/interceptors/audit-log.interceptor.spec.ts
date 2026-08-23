import { AuditLogInterceptor } from './audit-log.interceptor';

describe('AuditLogInterceptor pickup point audit support', () => {
  it('captures PickupPoint snapshots for before/after diffs', async () => {
    const pickupPoint = { id: 'point-1', isActive: true };
    const prisma = {
      pickupPoint: { findUnique: jest.fn().mockResolvedValue(pickupPoint) },
    };
    const interceptor = new AuditLogInterceptor({} as any, prisma as any);

    await expect(
      (interceptor as any).captureSnapshot('PickupPoint', 'point-1'),
    ).resolves.toEqual(pickupPoint);
    expect(prisma.pickupPoint.findUnique).toHaveBeenCalledWith({
      where: { id: 'point-1' },
    });
  });

  it('persists a sanitized status reason in the audit summary', () => {
    const interceptor = new AuditLogInterceptor({} as any, {} as any);
    const summary = (interceptor as any).buildSummary(
      {
        action: 'UPDATE',
        module: 'pickup',
        targetType: 'PickupPoint',
        reasonBodyField: 'reason',
      },
      { body: { reason: '门店调整，联系 13812345678' } },
    );

    expect(summary).toContain('原因：门店调整');
    expect(summary).toContain('138****5678');
    expect(summary).not.toContain('13812345678');
  });
});
