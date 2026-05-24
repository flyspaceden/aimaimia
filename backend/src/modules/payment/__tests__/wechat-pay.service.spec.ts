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
      get: (key: string) => envOverrides[key],
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
});
