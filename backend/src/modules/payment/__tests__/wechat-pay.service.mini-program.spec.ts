import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'crypto';
import { WechatPayService } from '../wechat-pay.service';

jest.mock('wechatpay-node-v3', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    transactions_jsapi: jest.fn(),
    createHttp: jest.fn(),
  })),
}));

describe('WechatPayService mini-program JSAPI payment', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const merchantPrivateKey = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const rsaPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const baseEnv = {
    WECHAT_PAY_APP_ID: 'wx-app-id',
    WECHAT_MINIAPP_APP_ID: 'wx-mini-id',
    WECHAT_PAY_MCH_ID: '1234567890',
    WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
    WECHAT_PAY_MERCHANT_CERT_SERIAL: 'SERIAL1',
    WECHAT_PAY_MERCHANT_CERT: rsaPublicKey,
    WECHAT_PAY_MERCHANT_PRIVATE_KEY: merchantPrivateKey,
    WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_123456',
    WECHAT_PAY_PUBLIC_KEY: rsaPublicKey,
    WECHAT_PAY_NOTIFY_URL: 'https://api.test.ai-maimai.com/api/v1/payments/wechat/notify',
  };

  async function build(overrides: Record<string, string | undefined> = {}) {
    const env = { ...baseEnv, ...overrides };
    const config = {
      get: (key: string, fallback?: string) => env[key as keyof typeof env] ?? fallback,
    } as ConfigService;
    const moduleRef = await Test.createTestingModule({
      providers: [
        WechatPayService,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    const service = moduleRef.get(WechatPayService);
    await service.onModuleInit();
    return service;
  }

  it('uses the configured mini-program appid and trusted openid, then returns requestPayment fields', async () => {
    const service = await build();
    const client = (service as any).client;
    client.transactions_jsapi.mockResolvedValue({
      status: 200,
      data: {
        appId: 'wx-mini-id',
        timeStamp: '1785686400',
        nonceStr: 'nonce-from-sdk',
        package: 'prepay_id=wx-prepay-1',
        signType: 'RSA',
        paySign: 'signed-by-merchant-key',
      },
    });

    const result = await service.createMiniProgramOrder({
      outTradeNo: 'CS-MINI-1',
      amount: 88.01,
      description: '爱买买订单',
      openId: 'openid-from-server-identity',
      timeExpire: new Date('2026-08-02T12:34:56.789Z'),
    });

    expect(client.transactions_jsapi).toHaveBeenCalledWith({
      appid: 'wx-mini-id',
      mchid: '1234567890',
      description: '爱买买订单',
      out_trade_no: 'CS-MINI-1',
      notify_url: expect.any(String),
      amount: { total: 8801, currency: 'CNY' },
      payer: { openid: 'openid-from-server-identity' },
      time_expire: '2026-08-02T12:34:56Z',
    });
    expect(result).toEqual({
      appId: 'wx-mini-id',
      timeStamp: '1785686400',
      nonceStr: 'nonce-from-sdk',
      package: 'prepay_id=wx-prepay-1',
      signType: 'RSA',
      paySign: 'signed-by-merchant-key',
      prepayId: 'wx-prepay-1',
    });
    expect(result).not.toHaveProperty('openId');
  });

  it('keeps APP payment available while mini-program payment is disabled without mini appid', async () => {
    const service = await build({ WECHAT_MINIAPP_APP_ID: '' });

    expect(service.isAvailable()).toBe(true);
    expect(service.isMiniProgramAvailable()).toBe(false);
    await expect(service.createMiniProgramOrder({
      outTradeNo: 'CS-MINI-NO-APPID',
      amount: 1,
      description: 'test',
      openId: 'openid',
    })).rejects.toThrow('微信小程序 AppID 未配置');
  });

  it('rejects an empty trusted openid before calling WeChat', async () => {
    const service = await build();
    const client = (service as any).client;

    await expect(service.createMiniProgramOrder({
      outTradeNo: 'CS-MINI-NO-OPENID',
      amount: 1,
      description: 'test',
      openId: '   ',
    })).rejects.toThrow('当前账号未绑定微信小程序身份');
    expect(client.transactions_jsapi).not.toHaveBeenCalled();
  });

  it('fails closed when JSAPI response lacks a valid merchant signature payload', async () => {
    const service = await build();
    const client = (service as any).client;
    client.transactions_jsapi.mockResolvedValue({
      status: 200,
      data: {
        appId: 'wx-mini-id',
        timeStamp: '1785686400',
        nonceStr: 'nonce',
        package: 'prepay_id=wx-prepay-1',
        signType: 'RSA',
      },
    });

    await expect(service.createMiniProgramOrder({
      outTradeNo: 'CS-MINI-NO-SIGN',
      amount: 1,
      description: 'test',
      openId: 'openid',
    })).rejects.toThrow('微信小程序支付下单返回缺少必要签名字段');
  });
});
