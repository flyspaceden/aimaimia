export type DigitalAssetLedgerType =
  | 'ORDER_RECEIVED'
  | 'REFUND_REVERSAL'
  | 'ADMIN_ADJUSTMENT'
  | 'BACKFILL';

export type DigitalAssetLedgerDirection = 'CREDIT' | 'DEBIT';

export type DigitalAssetModuleKey = 'assetValue' | 'level' | 'benefits' | 'equity';

export interface DigitalAssetModuleInfo {
  key: DigitalAssetModuleKey;
  title: string;
  status?: 'COMING_SOON';
  enabled?: boolean;
  description: string;
}

export interface DigitalAssetSummary {
  cumulativeSpendAmount: number;
  modules: DigitalAssetModuleInfo[];
}

export interface DigitalAssetLedger {
  id: string;
  type: DigitalAssetLedgerType;
  direction: DigitalAssetLedgerDirection;
  amount: number;
  balanceAfter: number;
  title: string;
  description?: string;
  orderId?: string;
  createdAt: string;
}
