import { BadRequestException } from '@nestjs/common';
import { ProductPricingService } from './product-pricing.service';

function makeRows() {
  return [
    {
      id: 'sku-a',
      title: '2斤装',
      price: 18,
      cost: 8,
      status: 'ACTIVE',
      product: {
        id: 'product-a',
        title: '有机番茄',
        companyId: 'company-a',
        categoryId: 'cat-a',
        status: 'ACTIVE',
        lotteryPrizes: [],
      },
      vipGiftItems: [],
    },
    {
      id: 'sku-b',
      title: '默认规格',
      price: 13,
      cost: 10,
      status: 'INACTIVE',
      product: {
        id: 'product-b',
        title: '已对齐商品',
        companyId: 'company-b',
        categoryId: null,
        status: 'INACTIVE',
        lotteryPrizes: [],
      },
      vipGiftItems: [],
    },
  ];
}

function createHarness() {
  const prisma: any = {
    ruleConfig: {
      findUnique: jest.fn().mockResolvedValue({ value: { value: 1.3 } }),
    },
    productSKU: {
      findMany: jest.fn().mockResolvedValue(makeRows()),
      update: jest.fn().mockResolvedValue({}),
    },
    product: {
      update: jest.fn().mockResolvedValue({}),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(async (write: any) => write(prisma)),
  };
  return { prisma, service: new ProductPricingService(prisma) };
}

describe('ProductPricingService', () => {
  it('builds a stable current-to-next price preview for non-platform seller SKUs', async () => {
    const { service, prisma } = createHarness();

    const plan = await service.buildMarkupRepricePlan(prisma, 1.3);

    expect(plan.preview).toMatchObject({
      currentMarkupRate: 1.3,
      nextMarkupRate: 1.3,
      eligibleProductCount: 2,
      eligibleSkuCount: 2,
      affectedProductCount: 1,
      affectedSkuCount: 1,
      priceDecreaseCount: 1,
      unchangedSkuCount: 1,
    });
    expect(plan.preview.examples[0]).toMatchObject({
      skuId: 'sku-a',
      currentPrice: 18,
      nextPrice: 10.4,
    });
    expect(plan.preview.previewToken).toMatch(/^[a-f0-9]{64}$/);
    expect(prisma.productSKU.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        product: expect.objectContaining({ company: { isPlatform: false } }),
      }),
    }));
    expect(prisma.productSKU.findMany.mock.calls[0][0].where).not.toHaveProperty('status');
  });

  it('requires the exact preview token before a markup change can reprice products', async () => {
    const { service, prisma } = createHarness();
    const plan = await service.buildMarkupRepricePlan(prisma, 1.35);

    expect(() => service.assertMarkupRepriceConfirmed(plan, false, undefined))
      .toThrow(BadRequestException);
    expect(() => service.assertMarkupRepriceConfirmed(plan, true, 'stale'))
      .toThrow(BadRequestException);
    expect(() => service.assertMarkupRepriceConfirmed(
      plan,
      true,
      plan.preview.previewToken,
    )).not.toThrow();
  });

  it('updates SKU prices and product rollups with two set-based statements', async () => {
    const { service, prisma } = createHarness();
    const plan = await service.buildMarkupRepricePlan(prisma, 1.3);

    await service.applyMarkupReprice(prisma, plan);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.productSKU.update).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('fails closed when MARKUP_RATE is missing or invalid', async () => {
    const { service, prisma } = createHarness();
    prisma.ruleConfig.findUnique.mockResolvedValueOnce(null);

    await expect(service.getCurrentMarkupRate(prisma)).rejects.toThrow(
      'MARKUP_RATE 配置缺失或不合法',
    );
  });

  it('keeps platform reward products outside the eligible query boundary', async () => {
    const { service, prisma } = createHarness();
    prisma.productSKU.findMany.mockResolvedValueOnce([]);

    const plan = await service.buildMarkupRepricePlan(prisma, 1.3);

    expect(plan.preview.eligibleSkuCount).toBe(0);
    expect(plan.preview.affectedSkuCount).toBe(0);
  });

  it('uses the same JavaScript two-decimal result for half-cent boundaries', () => {
    const { service } = createHarness();

    expect(service.calculatePrice(562.9, 1.35)).toBe(759.91);
  });
});
