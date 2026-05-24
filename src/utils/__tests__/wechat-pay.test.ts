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

const { hasCompleteWechatPayPayload, payWithWechat } = require('../wechat-pay');

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

  it('maps react-native-wechat-lib WechatError.code user cancel to alipay-like 6001 status', async () => {
    mockPay.mockRejectedValue(Object.assign(new Error('cancel'), { code: -2, errStr: 'cancel' }));

    await expect(payWithWechat(payload)).resolves.toEqual(expect.objectContaining({
      success: false,
      resultStatus: '6001',
      errCode: -2,
    }));
  });

  it('returns a terminal error when WeChat is not installed', async () => {
    mockIsWXAppInstalled.mockResolvedValue(false);

    await expect(payWithWechat(payload)).resolves.toEqual(expect.objectContaining({
      success: false,
      resultStatus: '',
      errStr: 'WECHAT_NOT_INSTALLED',
    }));

    expect(mockPay).not.toHaveBeenCalled();
  });

  it('rejects incomplete payload before initializing the native SDK', async () => {
    await expect(payWithWechat({ ...payload, paySign: '' })).resolves.toEqual(expect.objectContaining({
      success: false,
      errStr: 'PAY_PARAMS_MISSING',
    }));

    expect(mockInitWechat).not.toHaveBeenCalled();
    expect(mockIsWXAppInstalled).not.toHaveBeenCalled();
    expect(mockPay).not.toHaveBeenCalled();
  });
});

describe('hasCompleteWechatPayPayload', () => {
  it('requires all WeChat APP pay fields', () => {
    expect(hasCompleteWechatPayPayload(payload)).toBe(true);
    expect(hasCompleteWechatPayPayload({ ...payload, appId: ' ' })).toBe(false);
    expect(hasCompleteWechatPayPayload({ ...payload, signType: '' })).toBe(false);
  });
});
