import Taro from '@tarojs/taro';

export const MINIAPP_PRIVACY_AGREE_BUTTON_ID = 'aim-miniapp-privacy-agree';

export type MiniappPrivacyRequest = {
  resolve: (option: Taro.onNeedPrivacyAuthorization.ResolveOption) => void;
  referrer: string;
};

type PrivacyRequestHandler = (request: MiniappPrivacyRequest) => void;

let activeHandler: PrivacyRequestHandler | null = null;
let listenerRegistered = false;

function registerPlatformListener(): void {
  if (listenerRegistered || typeof Taro.onNeedPrivacyAuthorization !== 'function') return;
  listenerRegistered = true;
  Taro.onNeedPrivacyAuthorization((resolve, eventInfo) => {
    resolve({ event: 'exposureAuthorization' });
    if (!activeHandler) {
      resolve({ event: 'disagree' });
      return;
    }
    activeHandler({ resolve, referrer: eventInfo?.referrer || '' });
  });
}

export function registerMiniappPrivacyAuthorization(handler: PrivacyRequestHandler): () => void {
  activeHandler = handler;
  registerPlatformListener();
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

export function resolveMiniappPrivacyRequest(
  request: MiniappPrivacyRequest,
  decision: 'agree' | 'disagree',
): void {
  request.resolve(decision === 'agree'
    ? { event: 'agree', buttonId: MINIAPP_PRIVACY_AGREE_BUTTON_ID }
    : { event: 'disagree' });
}

export function getMiniappPrivacyContractName(): Promise<string> {
  if (typeof Taro.getPrivacySetting !== 'function') return Promise.resolve('AI爱买买小程序隐私保护指引');
  return new Promise((resolve) => {
    Taro.getPrivacySetting({
      success: (result) => resolve(result.privacyContractName || 'AI爱买买小程序隐私保护指引'),
      fail: () => resolve('AI爱买买小程序隐私保护指引'),
    });
  });
}

export function openMiniappPrivacyContract(): Promise<void> {
  if (typeof Taro.openPrivacyContract !== 'function') {
    return Promise.reject(new Error('PRIVACY_CONTRACT_UNAVAILABLE'));
  }
  return new Promise((resolve, reject) => {
    Taro.openPrivacyContract({
      success: () => resolve(),
      fail: (error) => reject(new Error(error.errMsg || '无法打开隐私保护指引')),
    });
  });
}
