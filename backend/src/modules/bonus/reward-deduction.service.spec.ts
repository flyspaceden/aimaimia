import { BadRequestException } from '@nestjs/common';
import { RewardDeductionService } from './reward-deduction.service';

describe('RewardDeductionService', () => {
  const makePrisma = () => ({
    ruleConfig: {
      findMany: jest.fn().mockResolvedValue([
        { key: 'DEDUCTION_RATIO_NORMAL', value: { value: 0.1 } },
        { key: 'DEDUCTION_RATIO_VIP', value: { value: 0.15 } },
        { key: 'DEDUCTION_MIN_ORDER_AMOUNT', value: { value: 0 } },
      ]),
    },
    memberProfile: { findUnique: jest.fn() },
    rewardAccount: { findUnique: jest.fn() },
  });

  describe('calculateMaxDeductible', () => {
    it('uses VIP ratio and combines VIP/NORMAL point balances', async () => {
      const prisma = makePrisma();
      prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'VIP' });
      prisma.rewardAccount.findUnique
        .mockResolvedValueOnce({ id: 'acc-vip', balance: 100 })
        .mockResolvedValueOnce({ id: 'acc-normal', balance: 20 });
      const service = new RewardDeductionService(prisma as any);

      const result = await service.calculateMaxDeductible('u1', 200);

      expect(result).toEqual({
        pointsBalance: 120,
        pointsRatio: 0.15,
        maxDeductible: 30,
      });
    });

    it('uses NORMAL ratio and caps by available point balance', async () => {
      const prisma = makePrisma();
      prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'NORMAL' });
      prisma.rewardAccount.findUnique
        .mockResolvedValueOnce({ id: 'acc-vip', balance: 5.01 })
        .mockResolvedValueOnce({ id: 'acc-normal', balance: 0 });
      const service = new RewardDeductionService(prisma as any);

      const result = await service.calculateMaxDeductible('u1', 200);

      expect(result).toEqual({
        pointsBalance: 5.01,
        pointsRatio: 0.1,
        maxDeductible: 5.01,
      });
    });

    it('returns zero max when order is below deduction minimum', async () => {
      const prisma = makePrisma();
      prisma.ruleConfig.findMany.mockResolvedValue([
        { key: 'DEDUCTION_RATIO_NORMAL', value: { value: 0.1 } },
        { key: 'DEDUCTION_RATIO_VIP', value: { value: 0.15 } },
        { key: 'DEDUCTION_MIN_ORDER_AMOUNT', value: { value: 100 } },
      ]);
      prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'NORMAL' });
      prisma.rewardAccount.findUnique
        .mockResolvedValueOnce({ id: 'acc-vip', balance: 100 })
        .mockResolvedValueOnce({ id: 'acc-normal', balance: 100 });
      const service = new RewardDeductionService(prisma as any);

      const result = await service.calculateMaxDeductible('u1', 99.99);

      expect(result.pointsBalance).toBe(200);
      expect(result.maxDeductible).toBe(0);
    });
  });

  describe('reserveDeduction', () => {
    const makeTx = () => ({
      ruleConfig: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'DEDUCTION_RATIO_NORMAL', value: { value: 0.1 } },
          { key: 'DEDUCTION_RATIO_VIP', value: { value: 0.15 } },
          { key: 'DEDUCTION_MIN_ORDER_AMOUNT', value: { value: 0 } },
        ]),
      },
      memberProfile: { findUnique: jest.fn().mockResolvedValue({ tier: 'NORMAL' }) },
      rewardAccount: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rewardLedger: {
        create: jest.fn(),
      },
    });

    it('rejects requested amount above max deductible', async () => {
      const tx = makeTx();
      tx.rewardAccount.findUnique
        .mockResolvedValueOnce({ id: 'acc-vip', balance: 100, frozen: 0 })
        .mockResolvedValueOnce({ id: 'acc-normal', balance: 0, frozen: 0 });
      const service = new RewardDeductionService({} as any);

      await expect(service.reserveDeduction(tx as any, 'u1', 200, 25))
        .rejects.toThrow(BadRequestException);
    });

    it('reserves from VIP first and writes one DEDUCT ledger when VIP covers', async () => {
      const tx = makeTx();
      tx.rewardAccount.findUnique
        .mockResolvedValueOnce({ id: 'acc-vip', balance: 100, frozen: 0 })
        .mockResolvedValueOnce({ id: 'acc-normal', balance: 50, frozen: 0 })
        .mockResolvedValueOnce({ id: 'acc-vip', balance: 100, frozen: 0 })
        .mockResolvedValueOnce({ id: 'acc-normal', balance: 50, frozen: 0 });
      tx.rewardLedger.create.mockResolvedValueOnce({ id: 'ledger-vip' });
      const service = new RewardDeductionService({} as any);

      const result = await service.reserveDeduction(tx as any, 'u1', 200, 18);

      expect(result).toMatchObject({
        primaryLedgerId: 'ledger-vip',
        ledgerIds: ['ledger-vip'],
        deductedFromVip: 18,
        deductedFromNormal: 0,
      });
      expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'acc-vip', balance: { gte: 18 } },
        data: { balance: { decrement: 18 }, frozen: { increment: 18 } },
      });
      expect(tx.rewardLedger.create).toHaveBeenCalledTimes(1);
      expect(tx.rewardLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'acc-vip',
          userId: 'u1',
          entryType: 'DEDUCT',
          amount: 18,
          status: 'RESERVED',
          refType: 'CHECKOUT',
          meta: expect.objectContaining({ scheme: 'POINTS_DEDUCTION', role: 'SOLE' }),
        }),
      });
    });

    it('splits into two ledgers when VIP balance is insufficient', async () => {
      const tx = makeTx();
      tx.rewardAccount.findUnique
        .mockResolvedValueOnce({ id: 'acc-vip', balance: 5, frozen: 0 })
        .mockResolvedValueOnce({ id: 'acc-normal', balance: 20, frozen: 0 })
        .mockResolvedValueOnce({ id: 'acc-vip', balance: 5, frozen: 0 })
        .mockResolvedValueOnce({ id: 'acc-normal', balance: 20, frozen: 0 });
      tx.rewardLedger.create
        .mockResolvedValueOnce({ id: 'ledger-vip' })
        .mockResolvedValueOnce({ id: 'ledger-normal' });
      const service = new RewardDeductionService({} as any);

      const result = await service.reserveDeduction(tx as any, 'u1', 200, 18);

      expect(result).toMatchObject({
        primaryLedgerId: 'ledger-vip',
        ledgerIds: ['ledger-vip', 'ledger-normal'],
        deductedFromVip: 5,
        deductedFromNormal: 13,
      });
      expect(tx.rewardLedger.create).toHaveBeenCalledTimes(2);
      expect(tx.rewardLedger.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          accountId: 'acc-normal',
          entryType: 'DEDUCT',
          amount: 13,
          status: 'RESERVED',
          meta: expect.objectContaining({
            role: 'SECONDARY',
            siblingLedgerId: 'ledger-vip',
          }),
        }),
      });
    });

    it('returns null for zero requested amount', async () => {
      const service = new RewardDeductionService({} as any);

      await expect(service.reserveDeduction(makeTx() as any, 'u1', 200, 0))
        .resolves.toBeNull();
    });

    it('reserveDeductionUpTo reserves only the reward-available portion without rejecting a larger unified request', async () => {
      const tx = makeTx();
      tx.rewardAccount.findUnique
        .mockResolvedValueOnce({ id: 'acc-vip', balance: 10, frozen: 0 })
        .mockResolvedValueOnce({ id: 'acc-normal', balance: 0, frozen: 0 })
        .mockResolvedValueOnce({ id: 'acc-vip', balance: 10, frozen: 0 })
        .mockResolvedValueOnce({ id: 'acc-normal', balance: 0, frozen: 0 });
      tx.rewardLedger.create.mockResolvedValueOnce({ id: 'ledger-vip' });
      const service = new RewardDeductionService({} as any);

      const result = await service.reserveDeductionUpTo(tx as any, 'u1', 200, 18);

      expect(result).toMatchObject({
        primaryLedgerId: 'ledger-vip',
        ledgerIds: ['ledger-vip'],
        deductedFromVip: 10,
        deductedFromNormal: 0,
        amount: 10,
      });
      expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'acc-vip', balance: { gte: 10 } },
        data: { balance: { decrement: 10 }, frozen: { increment: 10 } },
      });
    });
  });

  describe('confirmDeduction/releaseDeduction', () => {
    const makeTx = () => ({
      rewardLedger: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rewardAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });

    it('confirms RESERVED ledgers by clearing frozen and marking VOIDED', async () => {
      const tx = makeTx();
      tx.rewardLedger.findMany.mockResolvedValue([
        { id: 'l1', accountId: 'acc-vip', amount: 5 },
        { id: 'l2', accountId: 'acc-normal', amount: 13 },
      ]);
      const service = new RewardDeductionService({} as any);

      await service.confirmDeduction(tx as any, 'DG-1');

      expect(tx.rewardAccount.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'acc-vip', frozen: { gte: 5 } },
        data: { frozen: { decrement: 5 } },
      });
      expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'RESERVED',
          entryType: 'DEDUCT',
          meta: { path: ['groupId'], equals: 'DG-1' },
        },
        data: { status: 'VOIDED' },
      });
    });

    it('releases RESERVED ledgers back to balance and marks AVAILABLE', async () => {
      const tx = makeTx();
      tx.rewardLedger.findMany.mockResolvedValue([
        { id: 'l1', accountId: 'acc-vip', amount: 18 },
      ]);
      const service = new RewardDeductionService({} as any);

      await service.releaseDeduction(tx as any, 'DG-1');

      expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'acc-vip', frozen: { gte: 18 } },
        data: { frozen: { decrement: 18 }, balance: { increment: 18 } },
      });
      expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'RESERVED',
          entryType: 'DEDUCT',
          meta: { path: ['groupId'], equals: 'DG-1' },
        },
        data: { status: 'AVAILABLE' },
      });
    });

    it('is idempotent when no RESERVED ledgers exist', async () => {
      const tx = makeTx();
      tx.rewardLedger.findMany.mockResolvedValue([]);
      const service = new RewardDeductionService({} as any);

      await service.confirmDeduction(tx as any, 'DG-1');
      await service.releaseDeduction(tx as any, 'DG-1');

      expect(tx.rewardAccount.updateMany).not.toHaveBeenCalled();
      expect(tx.rewardLedger.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('refundDeduction', () => {
    const makeTx = () => ({
      rewardLedger: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      rewardAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });

    it('skips when refundId was already restored', async () => {
      const tx = makeTx();
      tx.rewardLedger.findFirst.mockResolvedValue({ id: 'restore-existing' });
      const service = new RewardDeductionService({} as any);

      await service.refundDeduction(tx as any, {
        refundId: 'refund-1',
        orderId: 'order-1',
        originalGoodsAmount: 200,
        originalGoodsRefundAmount: 80,
        originalDeductAmount: 18,
        deductionGroupId: 'DG-1',
        isFinalRefund: false,
        cumulativeGoodsRefundAmount: 80,
      });

      expect(tx.rewardAccount.updateMany).not.toHaveBeenCalled();
      expect(tx.rewardLedger.create).not.toHaveBeenCalled();
    });

    it('restores a proportional amount using original goods amount', async () => {
      const tx = makeTx();
      tx.rewardLedger.findFirst.mockResolvedValue(null);
      tx.rewardLedger.findMany
        .mockResolvedValueOnce([
          { id: 'deduct-vip', accountId: 'acc-vip', userId: 'u1', amount: 18, meta: { groupId: 'DG-1' } },
        ])
        .mockResolvedValueOnce([]);
      const service = new RewardDeductionService({} as any);

      await service.refundDeduction(tx as any, {
        refundId: 'refund-1',
        orderId: 'order-1',
        originalGoodsAmount: 200,
        originalGoodsRefundAmount: 80,
        originalDeductAmount: 18,
        deductionGroupId: 'DG-1',
        isFinalRefund: false,
        cumulativeGoodsRefundAmount: 80,
      });

      expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'acc-vip' },
        data: { balance: { increment: 7.2 } },
      });
      expect(tx.rewardLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'acc-vip',
          userId: 'u1',
          entryType: 'ADJUST',
          amount: 7.2,
          status: 'AVAILABLE',
          refType: 'REFUND_RESTORE',
          refId: 'refund-1',
          meta: expect.objectContaining({
            groupId: 'DG-1',
            orderId: 'order-1',
            sourceLedgerId: 'deduct-vip',
          }),
        }),
      });
    });

    it('restores each account separately for a cross-account deduction', async () => {
      const tx = makeTx();
      tx.rewardLedger.findFirst.mockResolvedValue(null);
      tx.rewardLedger.findMany
        .mockResolvedValueOnce([
          { id: 'deduct-vip', accountId: 'acc-vip', userId: 'u1', amount: 10, meta: { groupId: 'DG-1' } },
          { id: 'deduct-normal', accountId: 'acc-normal', userId: 'u1', amount: 8, meta: { groupId: 'DG-1' } },
        ])
        .mockResolvedValueOnce([]);
      const service = new RewardDeductionService({} as any);

      await service.refundDeduction(tx as any, {
        refundId: 'refund-1',
        orderId: 'order-1',
        originalGoodsAmount: 200,
        originalGoodsRefundAmount: 100,
        originalDeductAmount: 18,
        deductionGroupId: 'DG-1',
        isFinalRefund: false,
        cumulativeGoodsRefundAmount: 100,
      });

      expect(tx.rewardAccount.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'acc-vip' },
        data: { balance: { increment: 5 } },
      });
      expect(tx.rewardAccount.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'acc-normal' },
        data: { balance: { increment: 4 } },
      });
      expect(tx.rewardLedger.create).toHaveBeenCalledTimes(2);
    });

    it('clears the remaining deduction on the final refund', async () => {
      const tx = makeTx();
      tx.rewardLedger.findFirst.mockResolvedValue(null);
      tx.rewardLedger.findMany
        .mockResolvedValueOnce([
          { id: 'deduct-vip', accountId: 'acc-vip', userId: 'u1', amount: 18, meta: { groupId: 'DG-1' } },
        ])
        .mockResolvedValueOnce([
          { id: 'restore-old', accountId: 'acc-vip', userId: 'u1', amount: 7.2, meta: { sourceLedgerId: 'deduct-vip' } },
        ]);
      const service = new RewardDeductionService({} as any);

      await service.refundDeduction(tx as any, {
        refundId: 'refund-2',
        orderId: 'order-1',
        originalGoodsAmount: 200,
        originalGoodsRefundAmount: 120,
        originalDeductAmount: 18,
        deductionGroupId: 'DG-1',
        isFinalRefund: true,
        cumulativeGoodsRefundAmount: 200,
      });

      expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'acc-vip' },
        data: { balance: { increment: 10.8 } },
      });
    });
  });
});
