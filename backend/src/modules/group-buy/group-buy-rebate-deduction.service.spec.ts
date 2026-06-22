import { BadRequestException } from '@nestjs/common';

import { GroupBuyRebateDeductionService } from './group-buy-rebate-deduction.service';

describe('GroupBuyRebateDeductionService', () => {
  const makePrisma = () => ({
    ruleConfig: {
      findMany: jest.fn().mockResolvedValue([
        { key: 'DEDUCTION_RATIO_NORMAL', value: { value: 0.1 } },
        { key: 'DEDUCTION_RATIO_VIP', value: { value: 0.15 } },
        { key: 'DEDUCTION_MIN_ORDER_AMOUNT', value: { value: 0 } },
      ]),
    },
    memberProfile: { findUnique: jest.fn() },
    groupBuyRebateAccount: { findUnique: jest.fn() },
  });

  describe('calculateMaxDeductible', () => {
    it('uses the existing checkout deduction ratio but only group-buy rebate balance', async () => {
      const prisma = makePrisma();
      prisma.memberProfile.findUnique.mockResolvedValue({ tier: 'VIP' });
      prisma.groupBuyRebateAccount.findUnique.mockResolvedValue({
        id: 'gba_1',
        balance: 50,
        reserved: 0,
      });
      const service = new GroupBuyRebateDeductionService(prisma as any);

      const result = await service.calculateMaxDeductible('user_1', 200);

      expect(result).toEqual({
        rebateBalance: 50,
        rebateRatio: 0.15,
        maxDeductible: 30,
      });
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
      groupBuyRebateAccount: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      groupBuyRebateLedger: {
        create: jest.fn().mockResolvedValue({ id: 'gbdl_1' }),
      },
    });

    it('rejects requested amount above max deductible', async () => {
      const tx = makeTx();
      tx.groupBuyRebateAccount.findUnique.mockResolvedValue({ id: 'gba_1', balance: 100, reserved: 0 });
      const service = new GroupBuyRebateDeductionService({} as any);

      await expect(service.reserveDeduction(tx as any, 'user_1', 200, 25))
        .rejects.toThrow(BadRequestException);
    });

    it('reserves group-buy rebate balance and writes an independent DEDUCT ledger', async () => {
      const tx = makeTx();
      tx.groupBuyRebateAccount.findUnique
        .mockResolvedValueOnce({ id: 'gba_1', userId: 'user_1', balance: 100, reserved: 0 })
        .mockResolvedValueOnce({ id: 'gba_1', userId: 'user_1', balance: 100, reserved: 0 });
      const service = new GroupBuyRebateDeductionService({} as any);

      const result = await service.reserveDeduction(tx as any, 'user_1', 200, 18);

      expect(result).toMatchObject({
        groupId: expect.stringMatching(/^GBD-/),
        ledgerId: 'gbdl_1',
        amount: 18,
      });
      expect(tx.groupBuyRebateAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'gba_1', balance: { gte: 18 } },
        data: {
          balance: { decrement: 18 },
          reserved: { increment: 18 },
        },
      });
      expect(tx.groupBuyRebateLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'gba_1',
          userId: 'user_1',
          type: 'DEDUCT',
          status: 'RESERVED',
          amount: 18,
          balanceBefore: 100,
          balanceAfter: 82,
          refType: 'CHECKOUT',
          idempotencyKey: expect.stringMatching(/^GROUP_BUY_DEDUCT:GBD-/),
          meta: expect.objectContaining({
            scheme: 'GROUP_BUY_REBATE_DEDUCTION',
            groupId: expect.stringMatching(/^GBD-/),
          }),
        }),
      });
    });
  });

  describe('confirmDeduction/releaseDeduction', () => {
    const makeTx = () => ({
      groupBuyRebateLedger: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      groupBuyRebateAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });

    it('confirms RESERVED ledgers by moving reserved amount into deducted total', async () => {
      const tx = makeTx();
      tx.groupBuyRebateLedger.findMany.mockResolvedValue([
        { id: 'gbdl_1', accountId: 'gba_1', amount: 18 },
      ]);
      const service = new GroupBuyRebateDeductionService({} as any);

      await service.confirmDeduction(tx as any, 'GBD-1');

      expect(tx.groupBuyRebateAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'gba_1', reserved: { gte: 18 } },
        data: {
          reserved: { decrement: 18 },
          deducted: { increment: 18 },
        },
      });
      expect(tx.groupBuyRebateLedger.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'RESERVED',
          type: 'DEDUCT',
          meta: { path: ['groupId'], equals: 'GBD-1' },
        },
        data: { status: 'COMPLETED' },
      });
    });

    it('releases RESERVED ledgers back to group-buy rebate balance', async () => {
      const tx = makeTx();
      tx.groupBuyRebateLedger.findMany.mockResolvedValue([
        { id: 'gbdl_1', accountId: 'gba_1', amount: 18 },
      ]);
      const service = new GroupBuyRebateDeductionService({} as any);

      await service.releaseDeduction(tx as any, 'GBD-1');

      expect(tx.groupBuyRebateAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'gba_1', reserved: { gte: 18 } },
        data: {
          reserved: { decrement: 18 },
          balance: { increment: 18 },
        },
      });
      expect(tx.groupBuyRebateLedger.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'RESERVED',
          type: 'DEDUCT',
          meta: { path: ['groupId'], equals: 'GBD-1' },
        },
        data: { status: 'VOIDED' },
      });
    });
  });

  describe('refundDeduction', () => {
    it('restores proportional group-buy rebate deduction for ordinary order refunds', async () => {
      const tx = {
        groupBuyRebateLedger: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn()
            .mockResolvedValueOnce([
              { id: 'gbdl_1', accountId: 'gba_1', userId: 'user_1', amount: 20, meta: { groupId: 'GBD-1' } },
            ])
            .mockResolvedValueOnce([]),
          create: jest.fn().mockResolvedValue({ id: 'restore_1' }),
        },
        groupBuyRebateAccount: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const service = new GroupBuyRebateDeductionService({} as any);

      await service.refundDeduction(tx as any, {
        refundId: 'refund_1',
        orderId: 'order_1',
        originalGoodsAmount: 200,
        originalGoodsRefundAmount: 50,
        originalDeductAmount: 20,
        deductionGroupId: 'GBD-1',
        isFinalRefund: false,
        cumulativeGoodsRefundAmount: 50,
      });

      expect(tx.groupBuyRebateAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'gba_1' },
        data: {
          balance: { increment: 5 },
          deducted: { decrement: 5 },
        },
      });
      expect(tx.groupBuyRebateLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'gba_1',
          userId: 'user_1',
          type: 'REFUND_RETURN',
          status: 'AVAILABLE',
          amount: 5,
          refType: 'REFUND_RESTORE',
          refId: 'refund_1',
          idempotencyKey: 'GROUP_BUY_REFUND_RETURN:refund_1:gbdl_1',
          meta: expect.objectContaining({
            groupId: 'GBD-1',
            sourceLedgerId: 'gbdl_1',
            originalGoodsRefundAmount: 50,
          }),
        }),
      });
    });
  });
});
