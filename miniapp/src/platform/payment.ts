import Taro from '@tarojs/taro';

export type MiniProgramPaymentParams = {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
  prepayId?: string;
};

function paymentErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'errMsg' in error) {
    return String((error as { errMsg?: unknown }).errMsg || '');
  }
  return String(error || '');
}

export function miniProgramCashierFailureMessage(error: unknown): string {
  const message = paymentErrorMessage(error);
  if (message === '微信小程序支付参数无效'
    || message === '微信小程序支付单号不一致'
    || message === '微信小程序支付 AppID 与当前小程序不一致') {
    return message;
  }
  return '微信收银台暂时无法打开，请稍后重试';
}

export async function requestMiniProgramPayment(params: MiniProgramPaymentParams): Promise<void> {
  if (!/^prepay_id=[A-Za-z0-9_-]{1,128}$/.test(params.package)
    || !/^\d{10}$/.test(params.timeStamp)
    || !params.nonceStr
    || !params.paySign) {
    throw new Error('微信小程序支付参数无效');
  }
  if (params.prepayId && params.package !== `prepay_id=${params.prepayId}`) {
    throw new Error('微信小程序支付单号不一致');
  }
  const runtimeAppId = Taro.getAccountInfoSync().miniProgram.appId;
  if (!params.appId || runtimeAppId !== params.appId) {
    throw new Error('微信小程序支付 AppID 与当前小程序不一致');
  }
  await Taro.requestPayment({
    timeStamp: params.timeStamp,
    nonceStr: params.nonceStr,
    package: params.package,
    signType: params.signType,
    paySign: params.paySign,
  });
}
