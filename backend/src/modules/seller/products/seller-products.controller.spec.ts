import { SellerProductsController } from './seller-products.controller';

describe('SellerProductsController', () => {
  it('passes productType query to seller product list service', () => {
    const productsService = {
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 50 }),
    };
    const controller = new SellerProductsController(productsService as any);

    void (controller.findAll as any)(
      'company_1',
      '2',
      '50',
      'ACTIVE',
      undefined,
      '苹果',
      'SIMPLE',
    );

    expect(productsService.findAll).toHaveBeenCalledWith(
      'company_1',
      2,
      50,
      'ACTIVE',
      undefined,
      '苹果',
      'SIMPLE',
    );
  });
});
