export type AccountDeletionBlockerCode =
  | 'IS_COMPANY_OWNER'
  | 'USER_NOT_ACTIVE'
  | 'ACTIVE_CHECKOUT_EXISTS'
  | 'PENDING_PAYMENT_EXISTS'
  | 'PENDING_AFTER_SALE_SHIPPING_PAYMENT_EXISTS'
  | 'WITHDRAW_PROCESSING_EXISTS';

export type AccountDeletionBlocker = {
  code: AccountDeletionBlockerCode;
  message: string;
  count: number;
};

export type AccountDeletionPreview = {
  canDelete: boolean;
  blockers: AccountDeletionBlocker[];
  assets: {
    points: number;
    coupons: number;
    withdrawableRewards: number;
    frozenRewards: number;
    digitalAssetSeedBalance: number;
    digitalAssetCreditBalance: number;
    groupBuyRebateBalance: number;
    groupBuyRebateReserved: number;
    captainBalance: number;
    captainFrozen: number;
    lotteryQuota: number;
    pendingWithdrawAmount: number;
    activeCheckoutCount: number;
  };
  pending: { paidOrders: number; activeAfterSales: number };
  identityVerify: 'SMS' | 'WECHAT_MODAL';
  maskedPhone?: string;
};

export type AccountDeletionExecuteInput = {
  confirmationMethod: 'SMS' | 'WECHAT_MODAL';
  smsCode?: string;
  modalConfirmText?: string;
  wechatDeletionProof?: string;
  acknowledgedNotice: true;
};

export type AccountDeletionExecuteResult = { ok: boolean; message: string };
