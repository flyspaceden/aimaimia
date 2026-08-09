import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestMerchantTransferConfirmation } from '@/platform/merchantTransfer';
import { miniProgramCashierFailureMessage, requestMiniProgramPayment } from '@/platform/payment';

const requestPaymentMock = vi.hoisted(() => vi.fn());

vi.mock('@tarojs/taro', () => ({
  default: {
    requestPayment: requestPaymentMock,
    getAccountInfoSync: vi.fn(() => ({ miniProgram: { appId: 'wx-mini' } })),
  },
}));

describe('WeChat money platform adapters', () => {
  beforeEach(() => {
    requestPaymentMock.mockReset();
    requestPaymentMock.mockResolvedValue({ errMsg: 'requestPayment:ok' });
  });

  it('keeps local contract failures actionable but redacts arbitrary cashier errors', () => {
    expect(miniProgramCashierFailureMessage(new Error('微信小程序支付参数无效'))).toBe('微信小程序支付参数无效');
    expect(miniProgramCashierFailureMessage({ errMsg: 'requestPayment:fail network timeout at internal host' }))
      .toBe('微信收银台暂时无法打开，请稍后重试');
  });

  it('passes only signed JSAPI fields to requestPayment', async () => {
    await requestMiniProgramPayment({
      appId: 'wx-mini',
      timeStamp: '1722556800',
      nonceStr: 'nonce',
      package: 'prepay_id=prepay-1',
      signType: 'RSA',
      paySign: 'signature',
    });
    expect(requestPaymentMock).toHaveBeenCalledWith({
      timeStamp: '1722556800',
      nonceStr: 'nonce',
      package: 'prepay_id=prepay-1',
      signType: 'RSA',
      paySign: 'signature',
    });
  });

  it('rejects malformed payment packages before opening WeChat Pay', async () => {
    await expect(requestMiniProgramPayment({
      appId: 'wx-mini',
      timeStamp: '1722556800',
      nonceStr: 'nonce',
      package: 'bad-package',
      signType: 'RSA',
      paySign: 'signature',
    })).rejects.toThrow('支付参数无效');
    expect(requestPaymentMock).not.toHaveBeenCalled();
  });

  it('rejects payment parameters signed for another mini program', async () => {
    await expect(requestMiniProgramPayment({
      appId: 'wx-other',
      timeStamp: '1722556800',
      nonceStr: 'nonce',
      package: 'prepay_id=prepay-1',
      signType: 'RSA',
      paySign: 'signature',
    })).rejects.toThrow('AppID');
    expect(requestPaymentMock).not.toHaveBeenCalled();
  });

  it('verifies runtime AppID before opening merchant transfer confirmation', async () => {
    const requestMerchantTransfer = vi.fn((option) => option.success?.({ errMsg: 'ok' }));
    vi.stubGlobal('wx', {
      canIUse: vi.fn(() => true),
      getAccountInfoSync: vi.fn(() => ({ miniProgram: { appId: 'wx-mini' } })),
      requestMerchantTransfer,
    });

    await requestMerchantTransferConfirmation({
      mchId: '1900000001',
      appId: 'wx-mini',
      package: 'confirm-package',
    });
    expect(requestMerchantTransfer).toHaveBeenCalledWith(expect.objectContaining({
      mchId: '1900000001',
      appId: 'wx-mini',
      package: 'confirm-package',
    }));

    await expect(requestMerchantTransferConfirmation({
      mchId: '1900000001',
      appId: 'wx-other',
      package: 'confirm-package',
    })).rejects.toThrow('AppID');
  });
});
