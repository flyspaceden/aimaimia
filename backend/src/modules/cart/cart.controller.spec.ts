import { CartController } from './cart.controller';

describe('CartController cartItemId quantity route', () => {
  it('forwards the authenticated user, exact cart row id, and quantity', async () => {
    const cartService = {
      updateItemQuantityById: jest.fn().mockResolvedValue({
        cartItemId: 'cart-item-1',
        skuId: 'sku-1',
        quantity: 3,
      }),
    };
    const controller = new CartController(cartService as any);

    await expect(controller.updateItemQuantityById(
      'buyer-1',
      'cart-item-1',
      { quantity: 3 },
    )).resolves.toEqual({
      cartItemId: 'cart-item-1',
      skuId: 'sku-1',
      quantity: 3,
    });
    expect(cartService.updateItemQuantityById).toHaveBeenCalledWith(
      'buyer-1',
      'cart-item-1',
      3,
    );
  });
});
