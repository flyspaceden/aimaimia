import { BadRequestException } from '@nestjs/common';
import { SellerProductsService } from './seller-products.service';

describe('SellerProductsService SKU weight validation', () => {
  const buildService = () => {
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product_1',
          companyId: 'company_1',
          status: 'INACTIVE',
          auditStatus: 'PENDING',
        }),
      },
      $transaction: jest.fn(),
    };
    const bonusConfig = { getSystemConfig: jest.fn() };
    const semanticFillService = { fillProduct: jest.fn() };
    return new SellerProductsService(
      prisma as any,
      bonusConfig as any,
      semanticFillService as any,
    );
  };

  it('create rejects SKU without positive weightGram before writing', async () => {
    const service = buildService();

    await expect(service.create('company_1', {
      title: '测试商品',
      description: '测试商品描述不少于十个字',
      categoryId: 'category_1',
      origin: { text: '山东烟台' },
      skus: [{
        specName: '默认规格',
        cost: 10,
        stock: 5,
        weightGram: 0,
      }],
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateSkus rejects SKU without weightGram before writing', async () => {
    const service = buildService();

    await expect(service.updateSkus('company_1', 'product_1', [{
      specName: '默认规格',
      cost: 10,
      stock: 5,
    } as any])).rejects.toBeInstanceOf(BadRequestException);
  });
});
