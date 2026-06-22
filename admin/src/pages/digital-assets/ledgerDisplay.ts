type LedgerStatus = 'FROZEN' | 'RELEASED' | 'VOIDED';

export type DigitalAssetLedgerStatusInput = {
  status?: LedgerStatus;
  releaseHint?: string;
};

export type DigitalAssetLedgerStatusMeta = {
  text: string;
  color: string;
  description?: string;
};

const ledgerStatusMap: Record<LedgerStatus, DigitalAssetLedgerStatusMeta> = {
  FROZEN: { text: '冻结中', color: 'cyan' },
  RELEASED: { text: '已释放', color: 'green' },
  VOIDED: { text: '已作废', color: 'red' },
};

export function getDigitalAssetLedgerStatusMeta(
  record: DigitalAssetLedgerStatusInput,
): DigitalAssetLedgerStatusMeta | null {
  if (!record.status) return null;
  const meta = ledgerStatusMap[record.status];
  if (!meta) return null;
  return {
    ...meta,
    description: record.status === 'FROZEN' ? record.releaseHint : undefined,
  };
}
