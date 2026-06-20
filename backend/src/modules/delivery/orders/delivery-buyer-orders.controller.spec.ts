import { DeliveryBuyerOrdersController } from './delivery-buyer-orders.controller';

describe('DeliveryBuyerOrdersController', () => {
  let service: {
    listBuyerOrders: jest.Mock;
    getBuyerOrder: jest.Mock;
  };
  let controller: DeliveryBuyerOrdersController;

  beforeEach(() => {
    service = {
      listBuyerOrders: jest.fn(),
      getBuyerOrder: jest.fn(),
    };
    controller = new DeliveryBuyerOrdersController(service as any);
  });

  it('delegates delivery buyer order routes with the authenticated delivery user id', async () => {
    await controller.listOrders('delivery_user_1', '2', '15', 'SHIPPED');
    await controller.getOrder('delivery_user_1', 'PSDD0000000000001');

    expect(service.listBuyerOrders).toHaveBeenCalledWith('delivery_user_1', {
      page: 2,
      pageSize: 15,
      status: 'SHIPPED',
    });
    expect(service.getBuyerOrder).toHaveBeenCalledWith(
      'delivery_user_1',
      'PSDD0000000000001',
    );
  });
});
