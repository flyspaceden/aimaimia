import { readFileSync } from 'fs';
import { join } from 'path';
import { RefundSideEffectsService } from './refund-side-effects.service';

describe('RefundSideEffectsService durable auto-refund outbox', () => {
  const makeHarness = () => {
    const rows: any[] = [
      {
        id: 'effect-digital', refundId: 'refund-1', orderId: 'order-1', refundAmount: 80,
        kind: 'DIGITAL_ASSET_REVERSAL', status: 'PENDING', attempts: 0,
      },
      {
        id: 'effect-captain', refundId: 'refund-1', orderId: 'order-1', refundAmount: 80,
        kind: 'CAPTAIN_COMMISSION_VOID', status: 'PENDING', attempts: 0,
      },
    ];
    const tx = {
      refundSideEffectOutbox: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const outbox = {
      findMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(
        rows.filter((row) => !where?.refundId || row.refundId === where.refundId),
      )),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = {
      refundSideEffectOutbox: outbox,
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'refund-1', orderId: 'order-1', amount: 80, status: 'REFUNDED',
          afterSaleId: null, merchantRefundNo: 'AUTO-CANCEL-order-1',
        }),
      },
      orderProfitSnapshot: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const digital = { reverseRefund: jest.fn().mockResolvedValue(undefined) };
    const captain = { voidForRefund: jest.fn().mockResolvedValue('voided') };
    const service = new RefundSideEffectsService(prisma as any, digital as any, captain as any);
    return { service, prisma, tx, outbox, digital, captain, rows };
  };

  it('persists both effects for LEGACY and only digital reversal for V3 in the caller transaction', async () => {
    const { service, tx } = makeHarness();

    await service.enqueueInTransaction(tx as any, {
      refundId: 'refund-1', orderId: 'order-1', refundAmount: 80, profitMode: 'LEGACY',
    });
    await service.enqueueInTransaction(tx as any, {
      refundId: 'refund-v3', orderId: 'order-v3', refundAmount: 50, profitMode: 'V3',
    });

    expect(tx.refundSideEffectOutbox.createMany).toHaveBeenNthCalledWith(1, {
      data: expect.arrayContaining([
        expect.objectContaining({ refundId: 'refund-1', kind: 'DIGITAL_ASSET_REVERSAL' }),
        expect.objectContaining({ refundId: 'refund-1', kind: 'CAPTAIN_COMMISSION_VOID' }),
      ]),
      skipDuplicates: true,
    });
    expect(tx.refundSideEffectOutbox.createMany).toHaveBeenNthCalledWith(2, {
      data: [expect.objectContaining({ refundId: 'refund-v3', kind: 'DIGITAL_ASSET_REVERSAL' })],
      skipDuplicates: true,
    });
  });

  it('replays both idempotent domain operations after process restart', async () => {
    const { service, digital, captain } = makeHarness();

    await service.processRefund('refund-1');

    expect(digital.reverseRefund).toHaveBeenCalledWith('refund-1');
    expect(captain.voidForRefund).toHaveBeenCalledWith('order-1', 'refund-1', 80);
  });

  it('keeps one failed effect retryable without blocking an independent effect', async () => {
    const { service, outbox, digital, captain } = makeHarness();
    digital.reverseRefund.mockRejectedValueOnce(new Error('digital asset temporarily down'));

    await service.processRefund('refund-1');

    expect(outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'effect-digital', leaseToken: expect.any(String) }),
      data: expect.objectContaining({ status: 'FAILED', runAt: expect.any(Date) }),
    }));
    expect(captain.voidForRefund).toHaveBeenCalledWith('order-1', 'refund-1', 80);
  });

  it('reclaims an expired PROCESSING lease after a worker crash', async () => {
    const { service, outbox, rows, digital } = makeHarness();
    rows.splice(1, 1);
    rows[0].status = 'PROCESSING';
    rows[0].leaseExpiresAt = new Date(Date.now() - 1_000);

    await service.processRefund('refund-1');

    expect(outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'effect-digital',
        OR: expect.arrayContaining([
          { status: 'PROCESSING', leaseExpiresAt: { lt: expect.any(Date) } },
        ]),
      }),
      data: expect.objectContaining({ status: 'PROCESSING', leaseToken: expect.any(String) }),
    }));
    expect(digital.reverseRefund).toHaveBeenCalledWith('refund-1');
  });

  it('defensively skips legacy captain void when a READY V3 snapshot exists', async () => {
    const { service, prisma, rows, captain, outbox } = makeHarness();
    rows.splice(0, 1);
    prisma.orderProfitSnapshot.findFirst.mockResolvedValueOnce({ id: 'snapshot-v3' });

    await service.processRefund('refund-1');

    expect(captain.voidForRefund).not.toHaveBeenCalled();
    expect(outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'effect-captain', leaseToken: expect.any(String) }),
      data: expect.objectContaining({ status: 'SUCCEEDED' }),
    }));
  });

  it('backfills historical REFUNDED automatic refunds and excludes V3 captain duplicates', () => {
    const sql = readFileSync(
      join(process.cwd(), 'prisma/migrations/20260821040000_refund_side_effect_outbox/migration.sql'),
      'utf8',
    );
    expect(sql).toContain('"status" = \'REFUNDED\'');
    expect(sql).toContain('"afterSaleId" IS NULL');
    expect(sql).toContain("'DIGITAL_ASSET_REVERSAL'");
    expect(sql).toContain("'CAPTAIN_COMMISSION_VOID'");
    expect(sql).toContain('"OrderProfitSnapshot"');
    expect(sql).toContain('"status" = \'READY\'');
    expect(sql).toContain('ON CONFLICT ("refundId", "kind") DO NOTHING');
  });
});
