import { DeliverySellerShippingController } from './delivery-seller-shipping.controller';

describe('DeliverySellerShippingController', () => {
  it('ships a seller suborder with merchant and staff scope', async () => {
    const shippingService = {
      shipSubOrder: jest.fn().mockResolvedValue({ ok: true }),
      listSellerShipments: jest.fn(),
    };
    const controller = new DeliverySellerShippingController(shippingService as any);

    await controller.ship('merchant_1', 'staff_1', 'sub_1');

    expect(shippingService.shipSubOrder).toHaveBeenCalledWith('merchant_1', 'staff_1', 'sub_1');
  });

  it('lists seller shipments for a seller-owned suborder', async () => {
    const shippingService = {
      shipSubOrder: jest.fn(),
      listSellerShipments: jest.fn().mockResolvedValue([]),
    };
    const controller = new DeliverySellerShippingController(shippingService as any);

    await controller.listShipments('merchant_1', 'sub_1');

    expect(shippingService.listSellerShipments).toHaveBeenCalledWith('merchant_1', 'sub_1');
  });
});
