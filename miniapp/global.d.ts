declare namespace NodeJS {
  interface ProcessEnv {
    TARO_APP_ENV?: 'development' | 'staging' | 'production';
    TARO_APP_API_BASE_URL?: string;
    TARO_APP_WS_BASE_URL?: string;
    TARO_APP_USE_MOCK?: string;
  }
}

type WechatMerchantTransferOption = {
  mchId: string;
  appId: string;
  package: string;
  success?: (result: { errMsg?: string }) => void;
  fail?: (result: { errMsg?: string }) => void;
};

declare const wx: {
  canIUse(api: string): boolean;
  requestMerchantTransfer(option: WechatMerchantTransferOption): void;
  getAccountInfoSync(): { miniProgram: { appId: string } };
};
