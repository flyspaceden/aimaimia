import { DeliverySellerOpsController } from './delivery-seller-ops.controller';

describe('DeliverySellerOpsController', () => {
  it('delegates dashboard, orders, company, and staff endpoints to the seller ops service', async () => {
    const sellerOpsService = {
      getDashboard: jest.fn().mockResolvedValue({ pendingShipmentCount: 3 }),
      listOrders: jest.fn().mockResolvedValue({ items: [] }),
      getOrder: jest.fn().mockResolvedValue({ id: 'sub_1' }),
      getCompany: jest.fn().mockResolvedValue({ id: 'merchant_1' }),
      updateCompany: jest.fn().mockResolvedValue({ id: 'merchant_1', name: '配送中心A' }),
      listStaff: jest.fn().mockResolvedValue([{ id: 'staff_1' }]),
      createStaff: jest.fn().mockResolvedValue({ id: 'staff_2' }),
      updateStaff: jest.fn().mockResolvedValue({ id: 'staff_1', status: 'ACTIVE' }),
    };
    const controller = new DeliverySellerOpsController(sellerOpsService as any);

    await expect(controller.dashboard('merchant_1')).resolves.toEqual({ pendingShipmentCount: 3 });
    await expect(controller.listOrders('merchant_1', '1', '10', 'COMPLETED')).resolves.toEqual({
      items: [],
    });
    await expect(controller.getOrder('merchant_1', 'sub_1')).resolves.toEqual({ id: 'sub_1' });
    await expect(controller.getCompany('merchant_1')).resolves.toEqual({ id: 'merchant_1' });
    await expect(
      controller.updateCompany('merchant_1', 'staff_owner', 'OWNER', {
        name: '配送中心A',
      }),
    ).resolves.toEqual({ id: 'merchant_1', name: '配送中心A' });
    await expect(controller.listStaff('merchant_1', 'staff_owner', 'OWNER')).resolves.toEqual([
      { id: 'staff_1' },
    ]);
    await expect(
      controller.createStaff('merchant_1', 'staff_owner', 'OWNER', {
        username: 'ops_2',
        role: 'OPERATOR',
      }),
    ).resolves.toEqual({ id: 'staff_2' });
    await expect(
      controller.updateStaff('merchant_1', 'staff_owner', 'OWNER', 'staff_1', {
        status: 'ACTIVE',
      }),
    ).resolves.toEqual({ id: 'staff_1', status: 'ACTIVE' });

    expect(sellerOpsService.getDashboard).toHaveBeenCalledWith('merchant_1');
    expect(sellerOpsService.listOrders).toHaveBeenCalledWith('merchant_1', {
      page: 1,
      pageSize: 10,
      status: 'COMPLETED',
    });
    expect(sellerOpsService.getOrder).toHaveBeenCalledWith('merchant_1', 'sub_1');
    expect(sellerOpsService.updateCompany).toHaveBeenCalledWith(
      {
        merchantId: 'merchant_1',
        deliverySellerStaffId: 'staff_owner',
        role: 'OWNER',
      },
      {
        name: '配送中心A',
      },
    );
    expect(sellerOpsService.listStaff).toHaveBeenCalledWith({
      merchantId: 'merchant_1',
      deliverySellerStaffId: 'staff_owner',
      role: 'OWNER',
    });
    expect(sellerOpsService.createStaff).toHaveBeenCalledWith(
      {
        merchantId: 'merchant_1',
        deliverySellerStaffId: 'staff_owner',
        role: 'OWNER',
      },
      {
        username: 'ops_2',
        role: 'OPERATOR',
      },
    );
    expect(sellerOpsService.updateStaff).toHaveBeenCalledWith(
      {
        merchantId: 'merchant_1',
        deliverySellerStaffId: 'staff_owner',
        role: 'OWNER',
      },
      'staff_1',
      {
        status: 'ACTIVE',
      },
    );
  });
});
