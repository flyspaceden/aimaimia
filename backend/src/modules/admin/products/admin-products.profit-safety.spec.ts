import { ProductBundleService } from '../../product/product-bundle.service';
import { AdminProductsService } from './admin-products.service';

describe('AdminProductsService profit safety lock', () => {
  const unsafe = new Error('unsafe candidate');

  function buildHarness() {
    const product = {
      id: 'product-1',
      companyId: 'company-1',
      categoryId: 'category-old',
      status: 'ACTIVE',
      auditStatus: 'APPROVED',
      type: 'SIMPLE',
      company: { isPlatform: false },
      lotteryPrizes: [],
      skus: [{
        id: 'sku-1',
        productId: 'product-1',
        price: 150,
        cost: 100,
        stock: 10,
        status: 'ACTIVE',
        vipGiftItems: [],
      }],
    };
    const tx = {
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        update: jest.fn().mockResolvedValue({ ...product, attributes: null }),
      },
      productSKU: {
        findMany: jest.fn().mockImplementation(async (args: any) => {
          if (args?.select?.id) return [{ id: 'sku-1' }];
          if (args?.select?.price) return [{ price: 160 }, { price: 130 }];
          return product.skus;
        }),
        update: jest.fn().mockResolvedValue({ id: 'sku-1' }),
        create: jest.fn().mockResolvedValue({ id: 'sku-new' }),
      },
      productTag: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      tag: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        update: jest.fn().mockResolvedValue(product),
      },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const profitSafety = {
      withCandidateChange: jest.fn().mockRejectedValue(unsafe),
    };
    const service = new (AdminProductsService as any)(
      prisma,
      new ProductBundleService(),
      profitSafety,
    ) as AdminProductsService;

    return { service, prisma, tx, profitSafety, product };
  }

  it('rejects an unsafe active product category change before any business write', async () => {
    const { service, prisma, tx, profitSafety } = buildHarness();
    let change: any;
    profitSafety.withCandidateChange.mockImplementationOnce(async (changeFactory: any) => {
      change = await changeFactory(tx);
      throw unsafe;
    });

    await expect(service.update('product-1', { categoryId: 'category-new' }))
      .rejects.toBe(unsafe);

    expect(change).toEqual(expect.objectContaining({
      skuUpserts: [expect.objectContaining({
          id: 'sku-1',
          productId: 'product-1',
          companyId: 'company-1',
          categoryId: 'category-new',
          price: 150,
          cost: 100,
          active: true,
          ordinary: true,
          vipDiscountEligible: true,
      })],
    }));
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it.each([
    ['toggleStatus', (service: AdminProductsService) => service.toggleStatus('product-1', 'ACTIVE')],
    ['audit approval', (service: AdminProductsService) => service.audit('product-1', 'APPROVED')],
  ])('rejects unsafe %s activation before writing', async (_label, invoke) => {
    const { service, prisma, tx, profitSafety } = buildHarness();
    let change: any;
    profitSafety.withCandidateChange.mockImplementationOnce(async (changeFactory: any) => {
      change = await changeFactory(tx);
      throw unsafe;
    });

    await expect(invoke(service)).rejects.toBe(unsafe);

    expect(change).toEqual(expect.objectContaining({
      skuUpserts: [expect.objectContaining({ id: 'sku-1', active: true })],
    }));
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('validates the exact merged active SKU prices and costs before admin SKU upserts', async () => {
    const { service, tx, profitSafety } = buildHarness();
    let change: any;
    profitSafety.withCandidateChange.mockImplementationOnce(async (changeFactory: any) => {
      change = await changeFactory(tx);
      throw unsafe;
    });

    await expect(service.updateSkus('product-1', {
      skus: [
        { id: 'sku-1', price: 160, stock: 8, weightGram: 500 },
        { price: 130, cost: 80, stock: 6, weightGram: 750 },
      ],
    })).rejects.toBe(unsafe);

    expect(change.skuUpserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'sku-1',
        price: 160,
        cost: 100,
        categoryId: 'category-old',
        active: true,
      }),
      expect.objectContaining({
        productId: 'product-1',
        price: 130,
        cost: 80,
        categoryId: 'category-old',
        active: true,
      }),
    ]));
    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(tx.productSKU.create).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('rebuilds an activation candidate under the lock after a concurrent SKU economic change', async () => {
    const { service, tx, profitSafety, product } = buildHarness();
    const initiallyInactive = { ...product, status: 'INACTIVE' };
    const lockedProduct = {
      ...initiallyInactive,
      skus: [{ ...product.skus[0], price: 101, cost: 100 }],
    };
    (service as any).prisma.product.findUnique.mockResolvedValue(initiallyInactive);
    tx.product.findUnique.mockResolvedValue(lockedProduct);
    let lockedChange: any;
    profitSafety.withCandidateChange.mockImplementation(async (changeOrFactory: any, write: any) => {
      lockedChange = typeof changeOrFactory === 'function'
        ? await changeOrFactory(tx)
        : changeOrFactory;
      return {
        result: await write(tx, {
          candidateSnapshot: { MARKUP_RATE: 1.35 },
          candidateSkus: lockedChange.skuUpserts,
          summary: { safe: true },
        }),
      };
    });

    await service.toggleStatus('product-1', 'ACTIVE');

    expect(lockedChange.skuUpserts).toEqual([
      expect.objectContaining({ id: 'sku-1', price: 101, cost: 100, active: true }),
    ]);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { status: 'ACTIVE' },
    });
  });

  it('uses the locked ACTIVE status when validating and executing an admin SKU update', async () => {
    const { service, tx, profitSafety, product } = buildHarness();
    const initiallyInactive = { ...product, status: 'INACTIVE' };
    const lockedProduct = { ...product, status: 'ACTIVE' };
    (service as any).prisma.product.findUnique.mockResolvedValue(initiallyInactive);
    tx.product.findUnique.mockResolvedValue(lockedProduct);
    let lockedChange: any;
    profitSafety.withCandidateChange.mockImplementation(async (changeOrFactory: any, write: any) => {
      lockedChange = typeof changeOrFactory === 'function'
        ? await changeOrFactory(tx)
        : changeOrFactory;
      return {
        result: await write(tx, {
          candidateSnapshot: { MARKUP_RATE: 1.35 },
          candidateSkus: lockedChange.skuUpserts,
          summary: { safe: true },
        }),
      };
    });

    await service.updateSkus('product-1', {
      skus: [{ id: 'sku-1', price: 102, cost: 100, stock: 8, weightGram: 500 }],
    });

    expect(lockedChange.skuUpserts).toEqual([
      expect.objectContaining({ id: 'sku-1', price: 102, cost: 100, active: true }),
    ]);
    expect(tx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'sku-1' },
      data: expect.objectContaining({ price: 102, cost: 100 }),
    });
  });
});
