export type MerchantTransferConfirmation = {
  mchId: string;
  appId: string;
  package: string;
};

export function canRequestMerchantTransfer(): boolean {
  return typeof wx !== 'undefined'
    && typeof wx.canIUse === 'function'
    && wx.canIUse('requestMerchantTransfer');
}

/**
 * 返回成功仅代表用户已从确认页返回，不代表转账已成功；
 * 最终状态必须再查后端提现记录。
 */
export function requestMerchantTransferConfirmation(
  confirmation: MerchantTransferConfirmation,
): Promise<void> {
  if (!canRequestMerchantTransfer()) {
    return Promise.reject(new Error('当前微信版本不支持确认收款'));
  }
  const runtimeAppId = wx.getAccountInfoSync().miniProgram.appId;
  if (runtimeAppId !== confirmation.appId) {
    return Promise.reject(new Error('转账 AppID 与当前小程序不一致'));
  }

  return new Promise((resolve, reject) => {
    wx.requestMerchantTransfer({
      mchId: confirmation.mchId,
      appId: confirmation.appId,
      package: confirmation.package,
      success: () => resolve(),
      fail: (result) => reject(new Error(result.errMsg || '确认收款失败')),
    });
  });
}
