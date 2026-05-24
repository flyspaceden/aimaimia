import { AfterSaleShippingPaymentService } from './after-sale-shipping-payment.service';

/**
 * 验证 AS_SHIP_PAY_ 商户单号格式策略：
 * - ALIPAY 始终用 legacy 格式 `AS_SHIP_PAY_${afterSaleId}`（不变，保护存量数据）
 * - WECHAT_PAY 用短码 `AS_SHIP_PAY_${sha256(afterSaleId)[0:16]}`（满足微信 32 字符限制）
 * - shortToken 必须确定性：同一 afterSaleId 永远映射同一商户单号
 *
 * 关键回归：上一轮 C2 fix 之前 ALIPAY 路径会被错误短码化，污染支付宝沙箱已建数据
 */
describe('AfterSaleShippingPaymentService 商户单号策略', () => {
  const buildService = () => {
    const prisma = {
      afterSaleShippingPayment: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn: any) =>
        typeof fn === 'function' ? fn({
          afterSaleRequest: { findUnique: jest.fn() },
          afterSaleShippingPayment: { upsert: jest.fn(), findUnique: jest.fn() },
          order: { findUnique: jest.fn() },
        }) : fn,
      ),
    };
    return new AfterSaleShippingPaymentService(prisma as any, {} as any);
  };

  describe('getMerchantPaymentNo 单号生成', () => {
    it('ALIPAY 必须保留完整 afterSaleId（即使超过 32 字符，支付宝允许）', () => {
      const svc = buildService();
      const longCuid = 'clxyz1234567890abcdefghij';  // 25 char CUID
      const result = (svc as any).getMerchantPaymentNo(longCuid, 'ALIPAY');
      expect(result).toBe(`AS_SHIP_PAY_${longCuid}`);
      expect(result.length).toBe(37);  // 超 32，但支付宝允许 64
    });

    it('WECHAT_PAY 必须把超长 afterSaleId 短码化到 ≤ 32 字符', () => {
      const svc = buildService();
      const longCuid = 'clxyz1234567890abcdefghij';
      const result = (svc as any).getMerchantPaymentNo(longCuid, 'WECHAT_PAY');
      expect(result).toMatch(/^AS_SHIP_PAY_[0-9A-F]{16}$/);
      expect(result.length).toBe(28);
      expect(result.length).toBeLessThanOrEqual(32);
    });

    it('WECHAT_PAY 短码确定性：同一 afterSaleId 永远映射同一商户单号', () => {
      const svc = buildService();
      const id = 'clxyz1234567890abcdefghij';
      const a = (svc as any).getMerchantPaymentNo(id, 'WECHAT_PAY');
      const b = (svc as any).getMerchantPaymentNo(id, 'WECHAT_PAY');
      const c = (svc as any).getMerchantPaymentNo(id, 'WECHAT_PAY');
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it('WECHAT_PAY 短码区分性：不同 afterSaleId 不应碰撞', () => {
      const svc = buildService();
      const ids = Array.from({ length: 200 }, (_, i) => `clxyz${i.toString().padStart(20, '0')}`);
      const tokens = new Set(ids.map((id) => (svc as any).getMerchantPaymentNo(id, 'WECHAT_PAY')));
      expect(tokens.size).toBe(200);  // 全部不同
    });

    it('WECHAT_PAY 短 afterSaleId（≤ 20 char）legacy 不超 32 时仍走 legacy 格式（兼容性）', () => {
      const svc = buildService();
      const shortId = 'short_id_abc';  // 12 char → legacy 24 char ≤ 32
      const result = (svc as any).getMerchantPaymentNo(shortId, 'WECHAT_PAY');
      expect(result).toBe(`AS_SHIP_PAY_${shortId}`);
    });
  });

  describe('getWechatMerchantRefundNo 退款单号', () => {
    it('微信退款单号确定性：同一 afterSaleId 永远映射同一退款单号', () => {
      const svc = buildService();
      const id = 'clxyz1234567890abcdefghij';
      const a = (svc as any).getWechatMerchantRefundNo(id);
      const b = (svc as any).getWechatMerchantRefundNo(id);
      expect(a).toBe(b);
      expect(a).toMatch(/^AS_SHIP_REF_[0-9A-F]{16}$/);
      expect(a.length).toBeLessThanOrEqual(32);
    });

    it('微信退款单号与支付单号不会撞 namespace', () => {
      const svc = buildService();
      const id = 'clxyz1234567890abcdefghij';
      const paymentNo = (svc as any).getMerchantPaymentNo(id, 'WECHAT_PAY');
      const refundNo = (svc as any).getWechatMerchantRefundNo(id);
      expect(paymentNo).not.toBe(refundNo);
      expect(paymentNo.startsWith('AS_SHIP_PAY_')).toBe(true);
      expect(refundNo.startsWith('AS_SHIP_REF_')).toBe(true);
    });
  });

  describe('shortToken 内部稳定性', () => {
    it('sha256[0:16] 大写 hex 输出格式', () => {
      const svc = buildService();
      const out = (svc as any).shortToken('test');
      expect(out).toMatch(/^[0-9A-F]{16}$/);
      // sha256('test') = 9f86d081884c7d659a2feaa0c55ad015...
      expect(out).toBe('9F86D081884C7D65');
    });
  });

  describe('wechatRefundAmountMatchesPayment 金额比对', () => {
    it('refund=total=payment.amount 完整匹配时返 true', () => {
      const svc = buildService();
      const match = (svc as any).wechatRefundAmountMatchesPayment(
        { refundAmountFen: 1000, totalAmountFen: 1000 },
        10,  // 元
      );
      expect(match).toBe(true);
    });

    it('refundAmount 与 payment 差 1 分应返 false', () => {
      const svc = buildService();
      const match = (svc as any).wechatRefundAmountMatchesPayment(
        { refundAmountFen: 999, totalAmountFen: 1000 },
        10,
      );
      expect(match).toBe(false);
    });

    it('refundAmountFen 缺失应返 false', () => {
      const svc = buildService();
      const match = (svc as any).wechatRefundAmountMatchesPayment(
        { totalAmountFen: 1000 },
        10,
      );
      expect(match).toBe(false);
    });

    it('payment.amount 为浮点累加误差时仍能匹配', () => {
      const svc = buildService();
      const noisyAmount = 0.1 + 0.2;  // 0.30000000000000004 → 30 分
      const match = (svc as any).wechatRefundAmountMatchesPayment(
        { refundAmountFen: 30, totalAmountFen: 30 },
        noisyAmount,
      );
      expect(match).toBe(true);
    });
  });
});
