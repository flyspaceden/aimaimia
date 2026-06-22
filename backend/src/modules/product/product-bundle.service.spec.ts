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

  it('rejects non-active or non-approved component products for submit or sell', async () => {
    const tx = {
      productSKU: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sku-pending',
            status: 'ACTIVE',
            weightGram: 500,
            product: {
              id: 'product-pending',
              companyId: 'company-self',
              status: 'ACTIVE',
              auditStatus: 'PENDING',
              type: 'SIMPLE',
            },
          },
        ]),
      },
    };

    await expect(service.validateSellerBundleItems(
      tx as any,
      'company-self',
      [{ skuId: 'sku-pending', quantity: 1 }],
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects inactive component products for submit or sell', async () => {
    const tx = {
      productSKU: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sku-inactive-product',
            status: 'ACTIVE',
            weightGram: 500,
            product: {
              id: 'product-inactive',
              companyId: 'company-self',
              status: 'INACTIVE',
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
      [{ skuId: 'sku-inactive-product', quantity: 1 }],
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects inactive component SKUs by default', async () => {
    const tx = {
      productSKU: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sku-offline',
            status: 'INACTIVE',
            weightGram: 500,
            product: {
              id: 'product-offline',
              companyId: 'company-self',
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
      [{ skuId: 'sku-offline', quantity: 1 }],
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-positive component weights by default', async () => {
    const tx = {
      productSKU: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sku-zero-weight',
            status: 'ACTIVE',
            weightGram: 0,
            product: {
              id: 'product-zero-weight',
              companyId: 'company-self',
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
      [{ skuId: 'sku-zero-weight', quantity: 1 }],
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows draft-save validation to relax only product status and audit', async () => {
    const tx = {
      productSKU: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sku-draft',
            status: 'ACTIVE',
            weightGram: 500,
            product: {
              id: 'product-draft',
              companyId: 'company-self',
              status: 'DRAFT',
              auditStatus: 'PENDING',
              type: 'SIMPLE',
            },
          },
        ]),
      },
    };

    await expect(service.validateSellerBundleItems(
      tx as any,
      'company-self',
      [{ skuId: 'sku-draft', quantity: 1 }],
      { allowDraft: true },
    )).resolves.toMatchObject([
      {
        skuId: 'sku-draft',
        quantity: 1,
        sku: {
          id: 'sku-draft',
          product: {
            id: 'product-draft',
            status: 'DRAFT',
            auditStatus: 'PENDING',
            type: 'SIMPLE',
          },
        },
      },
    ]);
  });

  it('rejects draft-save validation when a component product is itself a bundle', async () => {
    const tx = {
      productSKU: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sku-draft-bundle',
            status: 'ACTIVE',
            weightGram: 500,
            product: {
              id: 'product-draft-bundle',
              companyId: 'company-self',
              status: 'DRAFT',
              auditStatus: 'PENDING',
              type: 'BUNDLE',
            },
          },
        ]),
      },
    };

    await expect(service.validateSellerBundleItems(
      tx as any,
      'company-self',
      [{ skuId: 'sku-draft-bundle', quantity: 1 }],
      { allowDraft: true },
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('computes availability as min(floor(stock / quantity))', () => {
    expect(service.calculateAvailability([
      { stock: 11, quantity: 2 },
      { stock: 10, quantity: 3 },
      { stock: 12, quantity: 4 },
    ])).toBe(3);
  });

  it('treats inactive component SKU as zero bundle availability', () => {
    expect(service.calculateAvailability([
      { stock: 11, quantity: 2, skuStatus: 'ACTIVE' },
      { stock: 10, quantity: 1, skuStatus: 'INACTIVE' },
    ])).toBe(0);
  });

  it('treats inactive or unapproved component product as zero bundle availability', () => {
    expect(service.calculateAvailability([
      { stock: 11, quantity: 2, productStatus: 'ACTIVE', productAuditStatus: 'APPROVED' },
      { stock: 10, quantity: 1, productStatus: 'INACTIVE', productAuditStatus: 'APPROVED' },
    ])).toBe(0);
    expect(service.calculateAvailability([
      { stock: 11, quantity: 2, productStatus: 'ACTIVE', productAuditStatus: 'APPROVED' },
      { stock: 10, quantity: 1, productStatus: 'ACTIVE', productAuditStatus: 'PENDING' },
    ])).toBe(0);
  });

  it('clamps negative availability to 0', () => {
    expect(service.calculateAvailability([
      { stock: -1, quantity: 2 },
      { stock: 10, quantity: 1 },
    ])).toBe(0);
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

  it.each([0, -1, 1.5])('rejects invalid parent bundle quantity %s', (quantity) => {
    expect(() => service.buildInventoryMovements({
      skuId: 'bundle-sku',
      quantity,
      companyId: 'company-self',
      productSnapshot: {
        bundleItems: [
          {
            skuId: 'sku-a',
            skuTitle: '苹果 5kg',
            quantityPerBundle: 3,
          },
        ],
      },
    })).toThrow(BadRequestException);
  });

  it('rejects inventory fallback when bundle snapshot is missing', () => {
    expect(() => service.buildInventoryMovements({
      skuId: 'bundle-sku',
      quantity: 2,
      companyId: 'company-self',
    })).toThrow(BadRequestException);
  });

  it('rejects inventory fallback when bundle snapshot items are empty', () => {
    expect(() => service.buildInventoryMovements({
      skuId: 'bundle-sku',
      quantity: 2,
      companyId: 'company-self',
      productSnapshot: {
        bundleItems: [],
      },
    })).toThrow(BadRequestException);
  });

  it('rejects bundle snapshot component items with invalid totalQuantity', () => {
    expect(() => service.buildInventoryMovements({
      skuId: 'bundle-sku',
      quantity: 2,
      companyId: 'company-self',
      productSnapshot: {
        bundleItems: [
          {
            skuId: 'sku-a',
            skuTitle: '苹果 5kg',
            totalQuantity: 0,
          },
        ],
      },
    })).toThrow(BadRequestException);

    expect(() => service.buildInventoryMovements({
      skuId: 'bundle-sku',
      quantity: 2,
      companyId: 'company-self',
      productSnapshot: {
        bundleItems: [
          {
            skuId: 'sku-b',
            skuTitle: '橙子礼盒',
            totalQuantity: -1,
          },
        ],
      },
    })).toThrow(BadRequestException);

    expect(() => service.buildInventoryMovements({
      skuId: 'bundle-sku',
      quantity: 2,
      companyId: 'company-self',
      productSnapshot: {
        bundleItems: [
          {
            skuId: 'sku-c',
            skuTitle: '葡萄礼盒',
            totalQuantity: 1.5,
          },
        ],
      },
    })).toThrow(BadRequestException);
  });

  it.each([0, -1, 1.5])('rejects invalid quantityPerBundle %s when totalQuantity is absent', (quantityPerBundle) => {
    expect(() => service.buildInventoryMovements({
      skuId: 'bundle-sku',
      quantity: 2,
      companyId: 'company-self',
      productSnapshot: {
        bundleItems: [
          {
            skuId: 'sku-a',
            skuTitle: '苹果 5kg',
            quantityPerBundle,
          },
        ],
      },
    })).toThrow(BadRequestException);
  });
});
