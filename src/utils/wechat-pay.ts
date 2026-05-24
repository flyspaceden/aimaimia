import { Platform } from 'react-native';
import { initWechat } from '../services/wechat';

export interface WechatPayPayload {
  appId?: string;
  partnerId?: string;
  timestamp?: string;
  nonceStr?: string;
  prepayId?: string;
  packageVal?: string;
  signType?: string;
  paySign?: string;
}

export interface WechatPayResult {
  success: boolean;
  resultStatus: string;
  errCode?: number;
  errStr?: string;
}

export async function payWithWechat(payload: WechatPayPayload): Promise<WechatPayResult> {
  const initialized = await initWechat();
  if (!initialized) {
    return { success: false, resultStatus: '', errStr: 'NATIVE_UNAVAILABLE' };
  }

  try {
    const WeChatLib: typeof import('react-native-wechat-lib') = require('react-native-wechat-lib');

    if (Platform.OS === 'android') {
      const installed = await WeChatLib.isWXAppInstalled();
      if (!installed) {
        return { success: false, resultStatus: '', errStr: 'WECHAT_NOT_INSTALLED' };
      }
    }

    if (
      !payload.partnerId ||
      !payload.prepayId ||
      !payload.nonceStr ||
      !payload.timestamp ||
      !payload.packageVal ||
      !payload.paySign
    ) {
      return { success: false, resultStatus: '', errStr: 'PAY_PARAMS_MISSING' };
    }

    const result = await WeChatLib.pay({
      partnerId: payload.partnerId,
      prepayId: payload.prepayId,
      nonceStr: payload.nonceStr,
      timeStamp: payload.timestamp,
      package: payload.packageVal,
      sign: payload.paySign,
    });

    const errCode = Number(result?.errCode);
    if (errCode === 0) {
      return { success: true, resultStatus: '', errCode, errStr: result?.errStr };
    }
    if (errCode === -2) {
      return { success: false, resultStatus: '6001', errCode, errStr: result?.errStr };
    }
    return { success: false, resultStatus: '', errCode, errStr: result?.errStr };
  } catch (err: any) {
    const errCode = typeof err?.errCode === 'number' ? err.errCode : undefined;
    const errStr = err?.errStr || err?.errMsg || err?.message || 'UNKNOWN_ERROR';
    if (errCode === -2) {
      return { success: false, resultStatus: '6001', errCode, errStr };
    }
    return { success: false, resultStatus: '', errCode, errStr };
  }
}
