import { BadRequestException } from '@nestjs/common';
import { ProductBundleService } from './product-bundle.service';

describe('ProductBundleService', () => {
  const service = new ProductBundleService();

  it('merges duplicate SKU rows and preserves first sort order', () => {
    expect(service.mergeBundleItems([
      { skuId: 'sku-a', quantity: 2, sortOrder: 5 },
      { skuId: 'sku-b', quantity: 1, sortOrder: 1 },
      { skuId: 'sku-a', quantity: 3, sortOrder: 9 },
    ])).toEqual([
      { skuId: 'sku-a', quantity: 5, sortOrder: 5 },
      { skuId: 'sku-b', quantity: 1, sortOrder: 1 },
    ]);
  });

  it('rejects component SKU from another company', async () => {
    const tx = {
      productSKU: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sku-a',
            status: 'ACTIVE',
            weightGram: 500,
            product: {
              id: 'product-a',
              companyId: 'company-other',
              status: 'ACTIVE',
              auditStatus: 'APPROVED',
              type: 'SIMPLE',
            },
          },
        ]),
      },
    };

    await expect(service.validateSellerBundleItems(
      tx as any,
      'company-self',
      [{ skuId: 'sku-a', quantity: 1 }],
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects component SKU whose product type is BUNDLE', async () => {
    const tx = {
      productSKU: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sku-bundle',
            status: 'ACTIVE',
            weightGram: 500,
            product: {
              id: 'product-bundle',
              companyId: 'company-self',
              status: 'ACTIVE',
              auditStatus: 'APPROVED',
              type: 'BUNDLE',
            },
          },
        ]),
      },
    };

    await expect(service.validateSellerBundleItems(
      tx as any,
      'company-self',
      [{ skuId: 'sku-bundle', quantity: 1 }],
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('computes availability as min(floor(stock / quantity))', () => {
    expect(service.calculateAvailability([
      { stock: 11, quantity: 2 },
      { stock: 10, quantity: 3 },
      { stock: 12, quantity: 4 },
    ])).toBe(3);
  });

  it('computes total weight from component weights', () => {
    expect(service.calculateTotalWeightGram([
      { weightGram: 500, quantity: 2 },
      { weightGram: 1200, quantity: 1 },
      { weightGram: 80, quantity: 5 },
    ])).toBe(2600);
  });

  it('builds component inventory movements from an order snapshot', () => {
    expect(service.buildInventoryMovements({
      skuId: 'bundle-sku',
      quantity: 2,
      companyId: 'company-self',
      productSnapshot: {
        bundleItems: [
          {
            skuId: 'sku-a',
            skuTitle: '苹果 5kg',
            quantityPerBundle: 3,
          },
          {
            skuId: 'sku-b',
            skuTitle: '橙子礼盒',
            quantityPerBundle: 1,
          },
        ],
      },
    })).toEqual([
      {
        skuId: 'sku-a',
        quantity: 6,
        companyId: 'company-self',
        label: 'Bundle component: 苹果 5kg',
      },
      {
        skuId: 'sku-b',
        quantity: 2,
        companyId: 'company-self',
        label: 'Bundle component: 橙子礼盒',
      },
    ]);
  });
});
