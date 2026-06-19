import { DeliveryAdminSettlementController } from './delivery-admin-settlement.controller';

describe('DeliveryAdminSettlementController', () => {
  it('delegates listing and paid actions to the settlement service', async () => {
    const settlementService = {
      listAdminSettlements: jest.fn().mockResolvedValue({ items: [] }),
      markSettlementPaid: jest.fn().mockResolvedValue({ id: 'settlement_1', status: 'SETTLED' }),
    };
    const controller = new DeliveryAdminSettlementController(settlementService as any);

    await expect(controller.list('2', '30', 'PENDING')).resolves.toEqual({ items: [] });
    await expect(
      controller.markPaid('admin_1', 'settlement_1', {
        settledAmountCents: 1200,
      }),
    ).resolves.toEqual({ id: 'settlement_1', status: 'SETTLED' });

    expect(settlementService.listAdminSettlements).toHaveBeenCalledWith({
      page: 2,
      pageSize: 30,
      status: 'PENDING',
    });
    expect(settlementService.markSettlementPaid).toHaveBeenCalledWith('admin_1', 'settlement_1', {
      settledAmountCents: 1200,
    });
  });
});
