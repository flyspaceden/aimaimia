import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WechatPayService } from '../wechat-pay.service';

jest.mock('wechatpay-node-v3', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    transactions_app: jest.fn(),
    refunds: jest.fn(),
    find_refunds: jest.fn(),
    query: jest.fn(),
    close: jest.fn(),
    fetchCertificates: jest.fn(),
    verifySign: jest.fn(),
    decipher_gcm: jest.fn(),
  })),
}));

/**
 * 补强 WechatPayService 的边界场景：
 * - timestamp 5 分钟窗口的几个关键边界
 * - 解密返回字符串/对象两种格式都要能 normalize
 * - closeOrder 已被关闭 / 已支付的语义
 * - queryRefund 边界字段缺失
 * - createAppOrder time_expire 末尾毫秒被剥除
 */
describe('WechatPayService 边界与时间窗口', () => {
  const validWechatEnv = {
    WECHAT_PAY_APP_ID: 'wxtest',
    WECHAT_PAY_MCH_ID: '1234567890',
    WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
    WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
    WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
    WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
  };

  const buildSvc = async () => {
    const fakeConfig = {
      get: (key: string, defaultValue?: string) =>
        (validWechatEnv as Record<string, string | undefined>)[key] ?? defaultValue,
    } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      providers: [
        WechatPayService,
        { provide: ConfigService, useValue: fakeConfig },
      ],
    }).compile();
    const svc = moduleRef.get(WechatPayService);
    await svc.onModuleInit();
    return svc;
  };

  // ---------- timestamp 5 分钟窗口边界 ----------
  describe('parseNotify timestamp 窗口', () => {
    const baseHeaders = {
      signature: 'sig',
      nonce: 'n',
      serial: 's',
    };
    const baseBody = {
      event_type: 'TRANSACTION.SUCCESS',
      resource: { ciphertext: 'X', nonce: 'N', associated_data: '' },
    };
    const validDecrypted = {
      appid: 'wxtest',
      mchid: '1234567890',
      out_trade_no: 'CS-1',
      transaction_id: 'TXN-1',
      trade_state: 'SUCCESS',
      amount: { total: 100 },
    };

    it('timestamp 缺失（undefined）应拒绝', async () => {
      const svc = await buildSvc();
      await expect(
        svc.parseNotify({
          body: baseBody as any,
          rawBody: '{}',
          headers: { ...baseHeaders, timestamp: undefined as any },
        }),
      ).rejects.toThrow('timestamp 超过 5 分钟窗口');
    });

    it('timestamp 非数字字符串应拒绝', async () => {
      const svc = await buildSvc();
      await expect(
        svc.parseNotify({
          body: baseBody as any,
          rawBody: '{}',
          headers: { ...baseHeaders, timestamp: 'not-a-number' },
        }),
      ).rejects.toThrow('timestamp 超过 5 分钟窗口');
    });

    it('timestamp 恰好 299 秒前应通过', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.verifySign.mockResolvedValue(true);
      client.decipher_gcm.mockReturnValue(validDecrypted);

      const ts = String(Math.floor(Date.now() / 1000) - 299);
      const result = await svc.parseNotify({
        body: baseBody as any,
        rawBody: '{}',
        headers: { ...baseHeaders, timestamp: ts },
      });
      expect(result.type).toBe('payment');
    });

    it('timestamp 恰好 301 秒前应拒绝', async () => {
      const svc = await buildSvc();
      const ts = String(Math.floor(Date.now() / 1000) - 301);
      await expect(
        svc.parseNotify({
          body: baseBody as any,
          rawBody: '{}',
          headers: { ...baseHeaders, timestamp: ts },
        }),
      ).rejects.toThrow('timestamp 超过 5 分钟窗口');
    });

    it('timestamp 未来 301 秒（时钟漂移恶意场景）应拒绝', async () => {
      const svc = await buildSvc();
      const ts = String(Math.floor(Date.now() / 1000) + 301);
      await expect(
        svc.parseNotify({
          body: baseBody as any,
          rawBody: '{}',
          headers: { ...baseHeaders, timestamp: ts },
        }),
      ).rejects.toThrow('timestamp 超过 5 分钟窗口');
    });
  });

  // ---------- 解密返回字符串 vs 对象 ----------
  describe('parseNotify decrypted 格式归一化', () => {
    const freshHeaders = () => ({
      signature: 'sig',
      nonce: 'n',
      serial: 's',
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    const baseBody = {
      event_type: 'TRANSACTION.SUCCESS',
      resource: { ciphertext: 'X', nonce: 'N', associated_data: '' },
    };

    it('当 SDK 返回 JSON 字符串时应能 JSON.parse', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.verifySign.mockResolvedValue(true);
      client.decipher_gcm.mockReturnValue(
        JSON.stringify({
          appid: 'wxtest',
          mchid: '1234567890',
          out_trade_no: 'CS-1',
          transaction_id: 'TXN-1',
          trade_state: 'SUCCESS',
          amount: { total: 200 },
        }),
      );

      const result = await svc.parseNotify({
        body: baseBody as any,
        rawBody: '{}',
        headers: freshHeaders(),
      });
      expect(result.amountFen).toBe(200);
      expect(result.outTradeNo).toBe('CS-1');
    });

    it('当 SDK 返回字符串但不是 JSON 时应抛错（防止后续静默吞）', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.verifySign.mockResolvedValue(true);
      client.decipher_gcm.mockReturnValue('not-a-json-string');

      await expect(
        svc.parseNotify({
          body: baseBody as any,
          rawBody: '{}',
          headers: freshHeaders(),
        }),
      ).rejects.toThrow();
    });
  });

  // ---------- closeOrder 状态机 ----------
  describe('closeOrder 状态码兜底', () => {
    it('SDK 返回 204 视为关单成功', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.close = jest.fn().mockResolvedValue({ status: 204 });

      const result = await svc.closeOrder('CS-1');
      expect(result).toEqual({
        success: true,
        terminal: false,
        alreadyPaid: false,
        message: '关单成功',
      });
    });

    it('SDK 返回 ORDERNOTEXIST 视为已终结', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.close = jest.fn().mockResolvedValue({
        status: 404,
        error: JSON.stringify({ code: 'ORDERNOTEXIST', message: '订单不存在' }),
      });
      const result = await svc.closeOrder('CS-not-exist');
      expect(result.success).toBe(true);
      expect(result.terminal).toBe(true);
      expect(result.alreadyPaid).toBe(false);
    });

    it('SDK 返回 ORDERPAID 必须标 alreadyPaid 触发主动建单', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.close = jest.fn().mockResolvedValue({
        status: 400,
        error: JSON.stringify({ code: 'ORDERPAID', message: '订单已支付' }),
      });
      const result = await svc.closeOrder('CS-paid');
      expect(result.alreadyPaid).toBe(true);
      expect(result.success).toBe(false);
      expect(result.terminal).toBe(false);
    });

    it('SDK 抛异常时返回失败但不 alreadyPaid（让上层重试）', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.close = jest.fn().mockRejectedValue(new Error('network'));
      const result = await svc.closeOrder('CS-net-err');
      expect(result.success).toBe(false);
      expect(result.alreadyPaid).toBe(false);
      expect(result.terminal).toBe(false);
    });

    it('outTradeNo 超过 32 字符时应安全降级为未建单（防止把账号带去微信被拒）', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      const result = await svc.closeOrder('X'.repeat(40));
      expect(result.success).toBe(true);
      expect(result.terminal).toBe(true);
      expect(client.close).not.toHaveBeenCalled();
    });
  });

  // ---------- queryRefund 边界 ----------
  describe('queryRefund 异常字段', () => {
    it('返回 out_refund_no 不匹配请求时返回 null（防止串号）', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          out_refund_no: 'OTHER-REFUND',
          out_trade_no: 'CS-1',
          refund_id: 'WX-R-1',
          status: 'SUCCESS',
          amount: { refund: 100, total: 100 },
        },
      });
      const result = await svc.queryRefund('REQ-REFUND');
      expect(result).toBeNull();
    });

    it('返回 amount.refund 非整数时返回 null', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          out_refund_no: 'REQ-REFUND',
          out_trade_no: 'CS-1',
          refund_id: 'WX-R-1',
          status: 'SUCCESS',
          amount: { refund: 9.5, total: 100 },
        },
      });
      const result = await svc.queryRefund('REQ-REFUND');
      expect(result).toBeNull();
    });

    it('返回 outTradeNo 是 64 char 应被 validateOutTradeNo 拦截，返回 null', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          out_refund_no: 'REQ-REFUND',
          out_trade_no: 'X'.repeat(64),  // 32 char 上限被破坏
          refund_id: 'WX-R-1',
          status: 'SUCCESS',
          amount: { refund: 100, total: 100 },
        },
      });
      const result = await svc.queryRefund('REQ-REFUND');
      expect(result).toBeNull();
    });

    it('未知 status 视为不可信，返回 null', async () => {
      const svc = await buildSvc();
      const client = (svc as any).client;
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          out_refund_no: 'REQ-REFUND',
          out_trade_no: 'CS-1',
          refund_id: 'WX-R-1',
          status: 'NEW_FUTURE_STATE',
          amount: { refund: 100, total: 100 },
        },
      });
      const result = await svc.queryRefund('REQ-REFUND');
      expect(result).toBeNull();
    });
  });

  // ---------- yuanToFenAmount 边界（防 float 误差） ----------
  describe('yuanToFenAmount 浮点精度', () => {
    it('0.1 + 0.2 累加误差应正确四舍五入到 30', () => {
      const sum = 0.1 + 0.2;  // 0.30000000000000004
      expect(WechatPayService.yuanToFenAmount(sum, 'amount')).toBe(30);
    });

    it('99.99 应转换为 9999 分', () => {
      expect(WechatPayService.yuanToFenAmount(99.99, 'amount')).toBe(9999);
    });

    it('3 位小数 0.015 应拒绝', () => {
      expect(() => WechatPayService.yuanToFenAmount(0.015, 'amount')).toThrow('最多支持 2 位小数');
    });

    it('0 / 负数应拒绝', () => {
      expect(() => WechatPayService.yuanToFenAmount(0, 'amount')).toThrow('必须大于 0');
      expect(() => WechatPayService.yuanToFenAmount(-1, 'amount')).toThrow('必须大于 0');
    });

    it('NaN / Infinity 应拒绝', () => {
      expect(() => WechatPayService.yuanToFenAmount(NaN, 'amount')).toThrow('必须是有效数字');
      expect(() => WechatPayService.yuanToFenAmount(Infinity, 'amount')).toThrow('必须是有效数字');
    });
  });
});
