declare const describe: (name: string, fn: () => void) => void;
declare const beforeEach: (fn: () => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const expect: any;
declare const jest: any;
declare const require: any;

const mockInitWechat = jest.fn().mockResolvedValue(true);
const mockIsWXAppInstalled = jest.fn().mockResolvedValue(true);
const mockPay = jest.fn();

jest.mock('../../services/wechat', () => ({
  __esModule: true,
  initWechat: mockInitWechat,
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('react-native-wechat-lib', () => ({
  isWXAppInstalled: mockIsWXAppInstalled,
  pay: mockPay,
}), { virtual: true });

const { payWithWechat } = require('../wechat-pay');

const payload = {
  appId: 'wx-app',
  partnerId: 'mch-001',
  timestamp: '1716537600',
  nonceStr: 'nonce-001',
  prepayId: 'wx-prepay-001',
  packageVal: 'Sign=WXPay',
  signType: 'RSA',
  paySign: 'wx-sign',
};

describe('payWithWechat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsWXAppInstalled.mockResolvedValue(true);
  });

  it('maps resolved WeChat user cancel to alipay-like 6001 status', async () => {
    mockPay.mockResolvedValue({ errCode: -2, errStr: 'cancel' });

    await expect(payWithWechat(payload)).resolves.toEqual(expect.objectContaining({
      success: false,
      resultStatus: '6001',
      errCode: -2,
    }));
  });

  it('maps rejected WeChat user cancel to alipay-like 6001 status', async () => {
    mockPay.mockRejectedValue({ errCode: -2, errStr: 'cancel' });

    await expect(payWithWechat(payload)).resolves.toEqual(expect.objectContaining({
      success: false,
      resultStatus: '6001',
      errCode: -2,
    }));
  });
});
