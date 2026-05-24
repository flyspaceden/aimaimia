import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WechatPayService } from '../wechat-pay.service';

jest.mock('wechatpay-node-v3', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    transactions_app: jest.fn(),
    refunds: jest.fn(),
    verifySign: jest.fn(),
    decipher_gcm: jest.fn(),
  })),
}));

describe('WechatPayService', () => {
  const buildModule = async (envOverrides: Record<string, string | undefined>) => {
    const fakeConfig = {
      get: (key: string, defaultValue?: string) => envOverrides[key] ?? defaultValue,
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

  describe('isAvailable', () => {
    it('returns false when WECHAT_PAY_APP_ID missing', async () => {
      const svc = await buildModule({});
      expect(svc.isAvailable()).toBe(false);
    });

    it('returns false when only partial credentials configured', async () => {
      const svc = await buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        // missing API V3 key + serial + private key
      });
      expect(svc.isAvailable()).toBe(false);
    });

    it('returns true when all required credentials present', async () => {
      const svc = await buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
        WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      });
      expect(svc.isAvailable()).toBe(true);
    });
  });

  describe('createAppOrder', () => {
    it('throws when SDK not available', async () => {
      const svc = await buildModule({});
      await expect(
        svc.createAppOrder({
          outTradeNo: 'CS-123',
          amount: 9.99,
          description: 'test',
        }),
      ).rejects.toThrow('微信支付 SDK 未初始化');
    });

    it('converts amount yuan to fen and returns signed app payload', async () => {
      const svc = await buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
        WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      });
      const client = (svc as any).client;
      // ⚠️ wechatpay-node-v3 SDK 实际返回 { status, data }，APP 支付字段在 data 内且为全小写
      // 参考 https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/transactions_app.md
      client.transactions_app = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          appid: 'wxtest',
          partnerid: '1234567890',
          prepayid: 'wx2024xxxxxxxxxxxxxxxx',
          package: 'Sign=WXPay',
          noncestr: 'NONCESTRX',
          timestamp: '1700000000',
          sign: 'SIGNED',
        },
      });

      const result = await svc.createAppOrder({
        outTradeNo: 'CS-456',
        amount: 9.99,
        description: 'unit test',
      });

      expect(client.transactions_app).toHaveBeenCalledWith(
        expect.objectContaining({
          out_trade_no: 'CS-456',
          description: 'unit test',
          amount: { total: 999, currency: 'CNY' },
          notify_url: expect.any(String),
        }),
      );
      // Service 对外（给 App 用）统一 camelCase，方便和 alipay 路径对齐
      expect(result).toEqual({
        appId: 'wxtest',
        partnerId: '1234567890',
        timestamp: '1700000000',
        nonceStr: 'NONCESTRX',
        prepayId: 'wx2024xxxxxxxxxxxxxxxx',
        packageVal: 'Sign=WXPay',
        signType: 'RSA',
        paySign: 'SIGNED',
      });
    });

    it('throws on non-200 SDK response', async () => {
      const svc = await buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
        WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
        WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
        WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
      });
      const client = (svc as any).client;
      client.transactions_app = jest.fn().mockResolvedValue({
        status: 400,
        error: JSON.stringify({ code: 'PARAM_ERROR', message: 'amount invalid' }),
      });
      await expect(
        svc.createAppOrder({ outTradeNo: 'CS-789', amount: 1, description: 't' }),
      ).rejects.toThrow(/PARAM_ERROR/);
    });
  });
});
