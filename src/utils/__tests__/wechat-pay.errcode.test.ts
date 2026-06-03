declare const describe: (name: string, fn: () => void) => void;
declare const beforeEach: (fn: () => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const expect: any;
declare const jest: any;
declare const require: any;

/**
 * 补强 payWithWechat 的 errCode 处理：
 * - SDK 实测可能返回数字 / 字符串两种 errCode 类型
 * - errCode=0 是成功
 * - errCode=-1 / -3 等其他失败码不应被错误识别为取消（避免假取消放过去）
 * - errCode 缺失（reject 但 error 对象没有 errCode）也要安全处理
 */
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

describe('payWithWechat errCode 兼容性', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsWXAppInstalled.mockResolvedValue(true);
    mockInitWechat.mockResolvedValue(true);
  });

  it('errCode=0 (数字) 视为成功', async () => {
    mockPay.mockResolvedValue({ errCode: 0, errStr: 'ok' });
    const result = await payWithWechat(payload);
    expect(result.success).toBe(true);
    expect(result.errCode).toBe(0);
  });

  it('errCode="0" (字符串数字) 也能正确识别为成功（SDK 兼容性）', async () => {
    mockPay.mockResolvedValue({ errCode: '0', errStr: 'ok' });
    const result = await payWithWechat(payload);
    expect(result.success).toBe(true);
    expect(result.errCode).toBe(0);
  });

  it('errCode="-2" (字符串) 应识别为用户取消 6001', async () => {
    mockPay.mockResolvedValue({ errCode: '-2', errStr: 'cancel' });
    const result = await payWithWechat(payload);
    expect(result.success).toBe(false);
    expect(result.resultStatus).toBe('6001');
    expect(result.errCode).toBe(-2);
  });

  it('errCode=-1 (一般错误) 不应被识别为取消 6001', async () => {
    mockPay.mockResolvedValue({ errCode: -1, errStr: 'general error' });
    const result = await payWithWechat(payload);
    expect(result.success).toBe(false);
    expect(result.resultStatus).toBe('');  // 6001 仅用于 -2
    expect(result.errCode).toBe(-1);
  });

  it('errCode=-3 (签名错误) 不应被识别为取消 6001', async () => {
    mockPay.mockResolvedValue({ errCode: -3, errStr: 'sign error' });
    const result = await payWithWechat(payload);
    expect(result.success).toBe(false);
    expect(result.resultStatus).toBe('');
  });

  it('reject 错误对象只有 message 时（无 errCode/code）应安全降级为未知错误', async () => {
    mockPay.mockRejectedValue(new Error('network unreachable'));
    const result = await payWithWechat(payload);
    expect(result.success).toBe(false);
    expect(result.resultStatus).toBe('');
    expect(result.errStr).toBe('network unreachable');
    expect(result.errCode).toBeUndefined();
  });

  it('reject 错误对象 code（非 errCode）也能被正确识别（SDK 别名兼容）', async () => {
    mockPay.mockRejectedValue({ code: -2, errStr: 'cancel via code field' });
    const result = await payWithWechat(payload);
    expect(result.success).toBe(false);
    expect(result.resultStatus).toBe('6001');
    expect(result.errCode).toBe(-2);
  });

  it('mockPay 返回 errCode 为非数字非字符串时（极端 SDK 异常）应降级为 undefined 不崩', async () => {
    mockPay.mockResolvedValue({ errCode: null, errStr: 'weird' });
    const result = await payWithWechat(payload);
    expect(result.success).toBe(false);
    expect(result.errCode).toBeUndefined();
  });

  it('initWechat 失败时应直接返回 NATIVE_UNAVAILABLE，不调 pay()', async () => {
    mockInitWechat.mockResolvedValue(false);
    const result = await payWithWechat(payload);
    expect(result.success).toBe(false);
    expect(result.errStr).toBe('NATIVE_UNAVAILABLE');
    expect(mockPay).not.toHaveBeenCalled();
  });

  it('iOS 平台下应跳过 isWXAppInstalled 检查（旧 SDK 行为）但仍调 pay()', async () => {
    // 临时改 Platform.OS
    const RN = require('react-native');
    const originalOS = RN.Platform.OS;
    RN.Platform.OS = 'ios';
    mockPay.mockResolvedValue({ errCode: 0 });

    try {
      const result = await payWithWechat(payload);
      expect(mockIsWXAppInstalled).not.toHaveBeenCalled();
      expect(mockPay).toHaveBeenCalled();
      expect(result.success).toBe(true);
    } finally {
      RN.Platform.OS = originalOS;
    }
  });
});

describe('payWithWechat 字段缺失防御', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsWXAppInstalled.mockResolvedValue(true);
    mockInitWechat.mockResolvedValue(true);
  });

  it('appId 缺失', async () => {
    const result = await payWithWechat({ ...payload, appId: '' });
    expect(result.errStr).toBe('PAY_PARAMS_MISSING');
  });

  it('prepayId 缺失', async () => {
    const result = await payWithWechat({ ...payload, prepayId: '' });
    expect(result.errStr).toBe('PAY_PARAMS_MISSING');
  });

  it('timestamp 缺失', async () => {
    const result = await payWithWechat({ ...payload, timestamp: '' });
    expect(result.errStr).toBe('PAY_PARAMS_MISSING');
  });

  it('paySign 是纯空白字符串视为缺失', async () => {
    const result = await payWithWechat({ ...payload, paySign: '   ' });
    expect(result.errStr).toBe('PAY_PARAMS_MISSING');
  });

  it('payload 是 null 时安全返回', async () => {
    const result = await payWithWechat(null as any);
    expect(result.errStr).toBe('PAY_PARAMS_MISSING');
  });

  it('payload 是 undefined 时安全返回', async () => {
    const result = await payWithWechat(undefined as any);
    expect(result.errStr).toBe('PAY_PARAMS_MISSING');
  });
});
