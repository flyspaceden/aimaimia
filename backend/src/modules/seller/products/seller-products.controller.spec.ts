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
      undefined,
    );
  });

  it('passes returnPolicy query to seller product list service', () => {
    const productsService = {
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    };
    const controller = new SellerProductsController(productsService as any);

    void (controller.findAll as any)(
      'company_1',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'RETURNABLE',
    );

    expect(productsService.findAll).toHaveBeenCalledWith(
      'company_1',
      1,
      20,
      undefined,
      undefined,
      undefined,
      undefined,
      'RETURNABLE',
    );
  });
});
