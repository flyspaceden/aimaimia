import { DeliveryAdminShippingRecordsController } from './delivery-admin-shipping-records.controller';

describe('DeliveryAdminShippingRecordsController', () => {
  it('lists admin delivery shipping records with parsed pagination params', async () => {
    const shippingService = {
      listAdminShippingRecords: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    const controller = new DeliveryAdminShippingRecordsController(shippingService as any);

    await controller.list('3', '15');

    expect(shippingService.listAdminShippingRecords).toHaveBeenCalledWith({
      page: 3,
      pageSize: 15,
    });
  });
});
