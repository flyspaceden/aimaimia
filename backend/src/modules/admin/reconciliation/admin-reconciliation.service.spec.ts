import { AdminReconciliationService } from './admin-reconciliation.service';

describe('AdminReconciliationService deduction mapping expectations', () => {
  it('expects paid checkout-session deduction ledgers to be VOIDED after payment success confirms deduction', () => {
    const service = new AdminReconciliationService({} as any, {} as any);

    expect((service as any).expectedDeductionLedgerStatus('ACTIVE')).toEqual({
      ledgerStatuses: ['RESERVED'],
      entryTypes: ['DEDUCT'],
    });
    expect((service as any).expectedDeductionLedgerStatus('PAID')).toEqual({
      ledgerStatuses: ['VOIDED'],
      entryTypes: ['DEDUCT'],
    });
    expect((service as any).expectedDeductionLedgerStatus('COMPLETED')).toEqual({
      ledgerStatuses: ['VOIDED'],
      entryTypes: ['DEDUCT'],
    });
  });
});
