import { DeliveryCartController } from './delivery-cart.controller';

describe('DeliveryCartController', () => {
  let service: {
    getCart: jest.Mock;
    addItem: jest.Mock;
    updateItem: jest.Mock;
    removeItem: jest.Mock;
  };
  let controller: DeliveryCartController;

  beforeEach(() => {
    service = {
      getCart: jest.fn(),
      addItem: jest.fn(),
      updateItem: jest.fn(),
      removeItem: jest.fn(),
    };
    controller = new DeliveryCartController(service as any);
  });

  it('delegates delivery cart routes with the authenticated delivery user id', async () => {
    const dto = { skuId: 'sku_1', quantity: 2 };
    const patchDto = { quantity: 4, isSelected: true };

    await controller.getCart('user_1');
    await controller.addItem('user_1', dto as any);
    await controller.updateItem('user_1', 'cart_1', patchDto as any);
    await controller.removeItem('user_1', 'cart_1');

    expect(service.getCart).toHaveBeenCalledWith('user_1');
    expect(service.addItem).toHaveBeenCalledWith('user_1', dto);
    expect(service.updateItem).toHaveBeenCalledWith('user_1', 'cart_1', patchDto);
    expect(service.removeItem).toHaveBeenCalledWith('user_1', 'cart_1');
  });
});
