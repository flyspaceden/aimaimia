import { DeliveryCheckoutController } from './delivery-checkout.controller';

describe('DeliveryCheckoutController', () => {
  let service: {
    createCheckout: jest.Mock;
    getCheckout: jest.Mock;
    createPaymentParams: jest.Mock;
  };
  let controller: DeliveryCheckoutController;

  beforeEach(() => {
    service = {
      createCheckout: jest.fn(),
      getCheckout: jest.fn(),
      createPaymentParams: jest.fn(),
    };
    controller = new DeliveryCheckoutController(service as any);
  });

  it('delegates delivery checkout routes with the authenticated delivery user id', async () => {
    const dto = { cartItemIds: ['cart_1'], addressId: 'addr_1', note: '尽快送达' };

    await controller.createCheckout('user_1', dto as any);
    await controller.getCheckout('user_1', 'checkout_1');
    await controller.createPaymentParams('user_1', 'checkout_1');

    expect(service.createCheckout).toHaveBeenCalledWith('user_1', dto);
    expect(service.getCheckout).toHaveBeenCalledWith('user_1', 'checkout_1');
    expect(service.createPaymentParams).toHaveBeenCalledWith('user_1', 'checkout_1');
  });
});
