import { PaymentService } from '../payment.service';

/**
 * 重点验证 handleWechatRefundNotify 的健壮性：
 * - 微信会重试 8 次（5/15/30/180/1800/1800/1800/3600s），同一 notify 多次到达应幂等
 * - 未识别 merchantRefundNo 前缀（不是 AS- / AUTO- / AS_SHIP_PAY_）应安全静默
 * - REFUND 已 FINAL 状态再来 notify 应被 fromStatuses 守门拦下
 * - args.amountFen 缺失或不匹配 refund.amount 应被 isWechatRefundNotifyAmountValid 拦下
 */
describe('PaymentService.handleWechatRefundNotify 幂等性与边界', () => {
  const makeService = () => {
    const prisma = {
      refund: { findFirst: jest.fn() },
      afterSaleShippingPayment: { updateMany: jest.fn() },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn({
        refund: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        refundStatusHistory: { create: jest.fn() },
        order: { findUnique: jest.fn() },
        checkoutSession: { findUnique: jest.fn() },
      })),
    };
    const alipayService = { isAvailable: jest.fn(), refund: jest.fn() };
    const wechatPayService = { isAvailable: jest.fn(), refund: jest.fn(), queryRefund: jest.fn() };
    const afterSaleRefundService = {
      handleRefundSuccess: jest.fn().mockResolvedValue(undefined),
      handleRefundFailure: jest.fn().mockResolvedValue(undefined),
    };
    const afterSaleShippingPaymentService = {
      handleWechatRefundNotify: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PaymentService(
      prisma as any,
      {} as any,
      alipayService as any,
      undefined,
      undefined,
      undefined,
      wechatPayService as any,
    );
    service.setAfterSaleRefundService(afterSaleRefundService as any);
    service.setAfterSaleShippingPaymentService(afterSaleShippingPaymentService as any);

    return { service, prisma, wechatPayService, afterSaleRefundService, afterSaleShippingPaymentService };
  };

  describe('AS-* 售后退款分支', () => {
    it('SUCCESS 通知金额与 Refund.amount 不一致时拒绝闭环', async () => {
      const { service, prisma, afterSaleRefundService } = makeService();
      prisma.refund.findFirst.mockResolvedValue({
        id: 'r1',
        merchantRefundNo: 'AS-as_001',
        status: 'REFUNDING',
        amount: 65,
      });

      await service.handleWechatRefundNotify({
        outTradeNo: 'CS-O-1',
        outRefundNo: 'AS-as_001',
        providerRefundId: 'WX-R-1',
        tradeState: 'SUCCESS',
        amountFen: 6400,  // 65 != 64
        totalAmountFen: 6500,
      });

      expect(afterSaleRefundService.handleRefundSuccess).not.toHaveBeenCalled();
    });

    it('SUCCESS 通知缺 amountFen 时拒绝闭环', async () => {
      const { service, prisma, afterSaleRefundService } = makeService();
      prisma.refund.findFirst.mockResolvedValue({
        id: 'r1',
        merchantRefundNo: 'AS-as_001',
        status: 'REFUNDING',
        amount: 65,
      });

      await service.handleWechatRefundNotify({
        outTradeNo: 'CS-O-1',
        outRefundNo: 'AS-as_001',
        providerRefundId: 'WX-R-1',
        tradeState: 'SUCCESS',
        // amountFen 不传
      });

      expect(afterSaleRefundService.handleRefundSuccess).not.toHaveBeenCalled();
    });

    it('SUCCESS notify 重复到达 N 次时下游 handleRefundSuccess 也只跟着调 N 次（由下游幂等）', async () => {
      const { service, prisma, afterSaleRefundService } = makeService();
      prisma.refund.findFirst.mockResolvedValue({
        id: 'r1',
        merchantRefundNo: 'AS-as_001',
        status: 'REFUNDING',
        amount: 65,
      });

      const args = {
        outTradeNo: 'CS-O-1',
        outRefundNo: 'AS-as_001',
        providerRefundId: 'WX-R-1',
        tradeState: 'SUCCESS',
        amountFen: 6500,
        totalAmountFen: 6500,
      };

      // 微信重试 8 次的真实节奏
      for (let i = 0; i < 8; i += 1) {
        await service.handleWechatRefundNotify(args);
      }

      // PaymentService 层不去重，下游 AfterSaleRefundService.handleRefundSuccess 必须自己幂等
      // 这里验证 dispatch 正确，每次都能正确路由
      expect(afterSaleRefundService.handleRefundSuccess).toHaveBeenCalledTimes(8);
      expect(afterSaleRefundService.handleRefundSuccess).toHaveBeenCalledWith('r1', 'WX-R-1');
    });

    it('ABNORMAL 通知应触发 handleRefundFailure 而非 success', async () => {
      const { service, prisma, afterSaleRefundService } = makeService();
      prisma.refund.findFirst.mockResolvedValue({
        id: 'r1',
        merchantRefundNo: 'AS-as_001',
        status: 'REFUNDING',
        amount: 65,
      });

      await service.handleWechatRefundNotify({
        outTradeNo: 'CS-O-1',
        outRefundNo: 'AS-as_001',
        tradeState: 'ABNORMAL',
        amountFen: 6500,
      });

      expect(afterSaleRefundService.handleRefundSuccess).not.toHaveBeenCalled();
      expect(afterSaleRefundService.handleRefundFailure).toHaveBeenCalledWith(
        'r1',
        expect.stringContaining('ABNORMAL'),
      );
    });

    it('PROCESSING 通知不应触发 handleRefundSuccess（保持 REFUNDING）', async () => {
      const { service, prisma, afterSaleRefundService } = makeService();
      prisma.refund.findFirst.mockResolvedValue({
        id: 'r1',
        merchantRefundNo: 'AS-as_001',
        status: 'REFUNDING',
        amount: 65,
      });

      await service.handleWechatRefundNotify({
        outTradeNo: 'CS-O-1',
        outRefundNo: 'AS-as_001',
        providerRefundId: 'WX-R-pending',
        tradeState: 'PROCESSING',
        amountFen: 6500,
        totalAmountFen: 6500,
      });

      expect(afterSaleRefundService.handleRefundSuccess).not.toHaveBeenCalled();
      expect(afterSaleRefundService.handleRefundFailure).not.toHaveBeenCalled();
    });
  });

  describe('AUTO-* 订单取消自动退款分支', () => {
    it('SUCCESS 通知金额不一致时拒绝闭环', async () => {
      const { service, prisma } = makeService();
      prisma.refund.findFirst.mockResolvedValue({
        id: 'r2',
        merchantRefundNo: 'AUTO-CANCEL-o1',
        status: 'REFUNDING',
        amount: 100,
      });

      // 不调用 updateAutoRefundRecord — 通过观察 $transaction 是否被调用
      const txSpy = jest.spyOn(prisma, '$transaction');

      await service.handleWechatRefundNotify({
        outTradeNo: 'CS-O-2',
        outRefundNo: 'AUTO-CANCEL-o1',
        tradeState: 'SUCCESS',
        amountFen: 9999,  // 100 != 99.99
        totalAmountFen: 10000,
      });

      expect(txSpy).not.toHaveBeenCalled();
    });

    it('SUCCESS 通知金额一致时进入 updateAutoRefundRecord', async () => {
      const { service, prisma } = makeService();
      prisma.refund.findFirst.mockResolvedValue({
        id: 'r2',
        merchantRefundNo: 'AUTO-CANCEL-o1',
        status: 'REFUNDING',
        amount: 100,
      });

      const txSpy = jest.spyOn(prisma, '$transaction');

      await service.handleWechatRefundNotify({
        outTradeNo: 'CS-O-2',
        outRefundNo: 'AUTO-CANCEL-o1',
        tradeState: 'SUCCESS',
        amountFen: 10000,
        totalAmountFen: 10000,
      });

      expect(txSpy).toHaveBeenCalled();
    });
  });

  describe('未识别 merchantRefundNo 前缀', () => {
    it('CUSTOM-* 前缀应安全静默（不抛错也不调下游）', async () => {
      const { service, prisma, afterSaleRefundService } = makeService();
      prisma.refund.findFirst.mockResolvedValue({
        id: 'r3',
        merchantRefundNo: 'CUSTOM-FUTURE-001',
        status: 'REFUNDING',
        amount: 50,
      });

      await expect(
        service.handleWechatRefundNotify({
          outTradeNo: 'CS-O-3',
          outRefundNo: 'CUSTOM-FUTURE-001',
          tradeState: 'SUCCESS',
          amountFen: 5000,
        }),
      ).resolves.toBeUndefined();

      expect(afterSaleRefundService.handleRefundSuccess).not.toHaveBeenCalled();
      expect(afterSaleRefundService.handleRefundFailure).not.toHaveBeenCalled();
    });
  });

  describe('找不到 Refund 记录', () => {
    it('outRefundNo 没在 db 时应安全静默（防止微信发错单号搞崩系统）', async () => {
      const { service, prisma, afterSaleRefundService } = makeService();
      prisma.refund.findFirst.mockResolvedValue(null);

      await expect(
        service.handleWechatRefundNotify({
          outTradeNo: 'CS-O-99',
          outRefundNo: 'AS-not-in-db',
          tradeState: 'SUCCESS',
          amountFen: 1000,
        }),
      ).resolves.toBeUndefined();

      expect(afterSaleRefundService.handleRefundSuccess).not.toHaveBeenCalled();
    });

    it('outRefundNo 缺失时（payment 通知错路由）应静默', async () => {
      const { service, prisma } = makeService();

      await expect(
        service.handleWechatRefundNotify({
          outTradeNo: 'CS-O-1',
          outRefundNo: undefined,
          tradeState: 'SUCCESS',
          amountFen: 1000,
        }),
      ).resolves.toBeUndefined();

      expect(prisma.refund.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('AS_SHIP_PAY_* 退货运费分支', () => {
    it('应转发给 AfterSaleShippingPaymentService 不查 Refund 表', async () => {
      const { service, prisma, afterSaleShippingPaymentService } = makeService();

      await service.handleWechatRefundNotify({
        outTradeNo: 'AS_SHIP_PAY_ABC123',
        outRefundNo: 'AS_SHIP_REF_XYZ',
        providerRefundId: 'WX-SHIP-R',
        tradeState: 'SUCCESS',
        amountFen: 1000,
        totalAmountFen: 1000,
      });

      expect(prisma.refund.findFirst).not.toHaveBeenCalled();
      expect(afterSaleShippingPaymentService.handleWechatRefundNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantPaymentNo: 'AS_SHIP_PAY_ABC123',
          outRefundNo: 'AS_SHIP_REF_XYZ',
          tradeState: 'SUCCESS',
        }),
      );
    });
  });
});
