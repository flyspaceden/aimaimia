import { DeliveryOrderShipmentsController } from './delivery-order-shipments.controller';

describe('DeliveryOrderShipmentsController', () => {
  it('lists buyer shipments for the current delivery user order', async () => {
    const shippingService = {
      listBuyerShipments: jest.fn().mockResolvedValue([]),
    };
    const controller = new DeliveryOrderShipmentsController(shippingService as any);

    await controller.listShipments('delivery_user_1', 'order_1');

    expect(shippingService.listBuyerShipments).toHaveBeenCalledWith('delivery_user_1', 'order_1');
  });
});
