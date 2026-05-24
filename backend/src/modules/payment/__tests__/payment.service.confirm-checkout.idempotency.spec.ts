import { PaymentService } from '../payment.service';

/**
 * 验证 confirmCheckout 的幂等性与状态机覆盖：
 *
 * 背景：App 端调起微信支付后会立即调 active-query；同时前端 polling 每 1 秒重试一次；
 * notify 异步也会到达。三路并发时必须保证只 handlePaymentCallback 一次。
 *
 * 微信 V3 trade_state 全集（5.4.2.2）：
 *   SUCCESS（支付成功）/ REFUND（转入退款）/ NOTPAY（未支付）/ CLOSED（已关闭）
 *   REVOKED（已撤销）/ USERPAYING（用户支付中）/ PAYERROR（支付失败）
 * 只有 SUCCESS 触发建单，其他 6 个状态都应保持 session 不变 + confirmedBy 反映状态。
 */
describe('PaymentService.confirmCheckout 幂等与状态机覆盖', () => {
  const userId = 'user-1';
  const sessionId = 'cs-test-1';
  const merchantOrderNo = 'CS-20260524-001';

  const buildService = (overrides: {
    sessions: any[];  // 一系列 findUnique 返回值，模拟连续调用
    wechatQueryResult?: any;
  }) => {
    const findUniqueMock = jest.fn();
    overrides.sessions.forEach((s) => findUniqueMock.mockResolvedValueOnce(s));
    findUniqueMock.mockResolvedValue(overrides.sessions[overrides.sessions.length - 1]);

    const prisma = {
      checkoutSession: { findUnique: findUniqueMock },
      afterSaleShippingPayment: { findUnique: jest.fn() },
    };
    const wechatPayService = {
      isAvailable: jest.fn().mockReturnValue(true),
      queryOrder: jest.fn().mockResolvedValue(overrides.wechatQueryResult ?? null),
    };
    const handlePaymentCallback = jest.fn().mockResolvedValue({ code: 'SUCCESS' });

    const service = new PaymentService(
      prisma as any,
      { get: jest.fn() } as any,
      { queryOrder: jest.fn() } as any,
      {} as any,
      undefined,
      undefined,
      wechatPayService as any,
    );
    (service as any).handlePaymentCallback = handlePaymentCallback;

    return { service, prisma, wechatPayService, handlePaymentCallback };
  };

  describe('polling 幂等：N 次连续 active-query 只触发一次建单', () => {
    it('第 1 次查到 SUCCESS 建单，第 2/3 次会因 session.status=COMPLETED 短路', async () => {
      const baseSession = {
        id: sessionId,
        userId,
        merchantOrderNo,
        expectedTotal: 100,
        paymentChannel: 'WECHAT_PAY',
        orders: [{ id: 'ord-1' }],
      };

      const { service, wechatPayService, handlePaymentCallback } = buildService({
        sessions: [
          // 第 1 次：ACTIVE → 触发 queryOrder + handlePaymentCallback
          { ...baseSession, status: 'ACTIVE' },
          // refresh after build：已 COMPLETED
          { ...baseSession, status: 'COMPLETED' },
          // 第 2 次：直接读到 COMPLETED → 短路
          { ...baseSession, status: 'COMPLETED' },
          // 第 3 次：同上
          { ...baseSession, status: 'COMPLETED' },
        ],
        wechatQueryResult: {
          tradeState: 'SUCCESS',
          transactionId: 'WX-T-1',
          outTradeNo: merchantOrderNo,
          totalAmountFen: 10000,
          totalAmount: 100,
        },
      });

      await service.confirmCheckout(sessionId, userId);
      await service.confirmCheckout(sessionId, userId);
      await service.confirmCheckout(sessionId, userId);

      // queryOrder 和 handlePaymentCallback 各只被调一次（第 1 次之后短路）
      expect(wechatPayService.queryOrder).toHaveBeenCalledTimes(1);
      expect(handlePaymentCallback).toHaveBeenCalledTimes(1);
    });

    it('第 1 次查到 NOTPAY 不建单，第 2 次仍可查（不锁死）', async () => {
      const baseSession = {
        id: sessionId,
        userId,
        merchantOrderNo,
        expectedTotal: 100,
        paymentChannel: 'WECHAT_PAY',
        orders: [],
      };

      const { service, wechatPayService, handlePaymentCallback } = buildService({
        sessions: [
          { ...baseSession, status: 'ACTIVE' },
          { ...baseSession, status: 'ACTIVE' },
        ],
        wechatQueryResult: {
          tradeState: 'NOTPAY',
          outTradeNo: merchantOrderNo,
          totalAmountFen: 10000,
          totalAmount: 100,
        },
      });

      const r1 = await service.confirmCheckout(sessionId, userId);
      const r2 = await service.confirmCheckout(sessionId, userId);

      expect(r1.status).toBe('ACTIVE');
      expect(r1.confirmedBy).toBe('wechat-notpay');
      expect(r2.status).toBe('ACTIVE');
      expect(handlePaymentCallback).not.toHaveBeenCalled();
      expect(wechatPayService.queryOrder).toHaveBeenCalledTimes(2);
    });
  });

  describe('微信 trade_state 全部 6 个非 SUCCESS 状态都不触发建单', () => {
    const transientStates = [
      'NOTPAY',
      'CLOSED',
      'REVOKED',
      'USERPAYING',
      'PAYERROR',
      'REFUND',
    ] as const;

    transientStates.forEach((state) => {
      it(`tradeState=${state} 时保持 session ACTIVE 不建单`, async () => {
        const baseSession = {
          id: sessionId,
          userId,
          merchantOrderNo,
          expectedTotal: 100,
          paymentChannel: 'WECHAT_PAY',
          orders: [],
        };

        const { service, handlePaymentCallback } = buildService({
          sessions: [
            { ...baseSession, status: 'ACTIVE' },
            { ...baseSession, status: 'ACTIVE' },
          ],
          wechatQueryResult: {
            tradeState: state,
            outTradeNo: merchantOrderNo,
            totalAmountFen: 10000,
            totalAmount: 100,
          },
        });

        const result = await service.confirmCheckout(sessionId, userId);

        expect(handlePaymentCallback).not.toHaveBeenCalled();
        expect(result.status).toBe('ACTIVE');
        expect(result.confirmedBy).toBe(`wechat-${state.toLowerCase()}`);
      });
    });
  });

  describe('防御场景', () => {
    it('CheckoutSession 不属于当前用户时抛 NotFoundException', async () => {
      const { service } = buildService({
        sessions: [
          {
            id: sessionId,
            userId: 'other-user',
            status: 'ACTIVE',
            merchantOrderNo,
            expectedTotal: 100,
            paymentChannel: 'WECHAT_PAY',
            orders: [],
          },
        ],
      });

      await expect(service.confirmCheckout(sessionId, userId)).rejects.toThrow();
    });

    it('CheckoutSession 已 EXPIRED 状态下应返回 EXPIRED + 不建单', async () => {
      const baseSession = {
        id: sessionId,
        userId,
        merchantOrderNo,
        expectedTotal: 100,
        paymentChannel: 'WECHAT_PAY',
        orders: [],
        status: 'EXPIRED',
      };

      const { service, wechatPayService, handlePaymentCallback } = buildService({
        sessions: [baseSession],
      });

      const result = await service.confirmCheckout(sessionId, userId);
      expect(result.status).toBe('EXPIRED');
      expect(wechatPayService.queryOrder).not.toHaveBeenCalled();
      expect(handlePaymentCallback).not.toHaveBeenCalled();
    });

    it('WECHAT_PAY 渠道但 SDK 未启用时返回 query-error 不抛错', async () => {
      const baseSession = {
        id: sessionId,
        userId,
        merchantOrderNo,
        expectedTotal: 100,
        paymentChannel: 'WECHAT_PAY',
        orders: [],
        status: 'ACTIVE',
      };

      const { service, wechatPayService, handlePaymentCallback } = buildService({
        sessions: [baseSession],
      });
      (wechatPayService.isAvailable as jest.Mock).mockReturnValue(false);

      const result = await service.confirmCheckout(sessionId, userId);
      expect(result.confirmedBy).toBe('query-error');
      expect(result.status).toBe('ACTIVE');
      expect(wechatPayService.queryOrder).not.toHaveBeenCalled();
      expect(handlePaymentCallback).not.toHaveBeenCalled();
    });

    it('SUCCESS 但缺 transactionId 时拒绝建单（防止假成功）', async () => {
      const baseSession = {
        id: sessionId,
        userId,
        merchantOrderNo,
        expectedTotal: 100,
        paymentChannel: 'WECHAT_PAY',
        orders: [],
        status: 'ACTIVE',
      };

      const { service, handlePaymentCallback } = buildService({
        sessions: [baseSession],
        wechatQueryResult: {
          tradeState: 'SUCCESS',
          // transactionId 缺失
          outTradeNo: merchantOrderNo,
          totalAmountFen: 10000,
          totalAmount: 100,
        },
      });

      await expect(service.confirmCheckout(sessionId, userId)).rejects.toThrow(/交易流水号/);
      expect(handlePaymentCallback).not.toHaveBeenCalled();
    });

    it('SUCCESS 但 totalAmountFen 与 expectedTotal 不匹配时拒绝建单', async () => {
      const baseSession = {
        id: sessionId,
        userId,
        merchantOrderNo,
        expectedTotal: 100,
        paymentChannel: 'WECHAT_PAY',
        orders: [],
        status: 'ACTIVE',
      };

      const { service, handlePaymentCallback } = buildService({
        sessions: [baseSession],
        wechatQueryResult: {
          tradeState: 'SUCCESS',
          transactionId: 'WX-T-1',
          outTradeNo: merchantOrderNo,
          totalAmountFen: 9999,  // 100 元 应该是 10000 分
          totalAmount: 99.99,
        },
      });

      await expect(service.confirmCheckout(sessionId, userId)).rejects.toThrow(/金额校验失败/);
      expect(handlePaymentCallback).not.toHaveBeenCalled();
    });
  });
});
