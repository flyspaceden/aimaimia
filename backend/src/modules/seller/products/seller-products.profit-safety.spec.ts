import { ProductBundleService } from '../../product/product-bundle.service';
import { SellerProductsService } from './seller-products.service';

describe('SellerProductsService profit safety lock', () => {
  const unsafe = new Error('unsafe candidate');

  function activeProduct() {
    return {
      id: 'product-1',
      companyId: 'company-1',
      categoryId: 'category-old',
      status: 'ACTIVE',
      auditStatus: 'APPROVED',
      type: 'SIMPLE',
      attributes: null,
      company: { isPlatform: false },
      lotteryPrizes: [],
      skus: [{
        id: 'sku-1',
        productId: 'product-1',
        title: '默认规格',
        price: 130,
        cost: 100,
        stock: 10,
        weightGram: 500,
        maxPerOrder: null,
        skuCode: null,
        status: 'ACTIVE',
        vipGiftItems: [],
      }],
      media: [],
      tags: [],
      bundleItems: [],
    };
  }

  function validDraft() {
    return {
      ...activeProduct(),
      status: 'DRAFT',
      auditStatus: 'PENDING',
      title: '草稿商品',
      subtitle: null,
      description: '这是一段足够长的商品描述',
      categoryId: 'category-old',
      returnPolicy: 'INHERIT',
      origin: { text: '山东烟台' },
      aiKeywords: [],
      flavorTags: [],
      seasonalMonths: [],
      usageScenarios: [],
      dietaryTags: [],
      originRegion: '山东烟台',
    };
  }

  function buildHarness(product = activeProduct()) {
    const tx = {
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        update: jest.fn().mockResolvedValue({ ...product, attributes: null }),
      },
      productSKU: {
        findMany: jest.fn().mockResolvedValue(product.skus),
        update: jest.fn().mockResolvedValue({ id: 'sku-1' }),
        create: jest.fn().mockResolvedValue({ id: 'sku-new' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      productBundleItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      productMedia: { deleteMany: jest.fn(), createMany: jest.fn() },
      productTag: { deleteMany: jest.fn(), createMany: jest.fn() },
      tag: { findMany: jest.fn().mockResolvedValue([]) },
      ruleConfig: {
        findUnique: jest.fn().mockResolvedValue({ value: { value: 1.3 } }),
      },
    };
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(product) },
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const bonusConfig = {
      getSystemConfig: jest.fn().mockResolvedValue({ markupRate: 1.3 }),
    };
    const semanticFill = { fillProduct: jest.fn().mockResolvedValue(undefined) };
    const profitSafety = {
      withCandidateChange: jest.fn().mockRejectedValue(unsafe),
    };
    const service = new (SellerProductsService as any)(
      prisma,
      bonusConfig,
      semanticFill,
      new ProductBundleService(),
      profitSafety,
    ) as SellerProductsService;

    return { service, prisma, tx, profitSafety, product };
  }

  it('rejects an unsafe active category change before seller writes', async () => {
    const { service, tx, profitSafety } = buildHarness();
    let change: any;
    profitSafety.withCandidateChange.mockImplementationOnce(async (changeFactory: any) => {
      change = await changeFactory(tx);
      throw unsafe;
    });

    await expect(service.update('company-1', 'product-1', {
      categoryId: 'category-new',
    })).rejects.toBe(unsafe);

    expect(change).toEqual(expect.objectContaining({
      skuUpserts: [expect.objectContaining({
          id: 'sku-1',
          categoryId: 'category-new',
          price: 130,
          cost: 100,
          active: true,
          ordinary: true,
      })],
    }));
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('validates the exact automatic price before changing an active seller SKU', async () => {
    const { service, tx, profitSafety } = buildHarness();
    let change: any;
    profitSafety.withCandidateChange.mockImplementationOnce(async (changeFactory: any) => {
      change = await changeFactory(tx);
      throw unsafe;
    });

    await expect(service.updateSkus('company-1', 'product-1', [{
      id: 'sku-1',
      specName: '默认规格',
      cost: 110,
      stock: 9,
      weightGram: 500,
    }])).rejects.toBe(unsafe);

    expect(change).toEqual(expect.objectContaining({
      skuUpserts: [expect.objectContaining({
          id: 'sku-1',
          price: 143,
          cost: 110,
          active: true,
      })],
    }));
    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('writes nothing when MARKUP_RATE changes before the safety callback acquires the lock', async () => {
    const { service, tx, profitSafety } = buildHarness();
    profitSafety.withCandidateChange.mockImplementation(
      async (changeFactory: any, write: (client: typeof tx, context: unknown) => Promise<unknown>) => {
        await changeFactory(tx);
        return {
          result: await write(tx, {
          candidateSnapshot: { MARKUP_RATE: 1.4 },
          }),
        };
      },
    );

    await expect(service.updateSkus('company-1', 'product-1', [{
      id: 'sku-1',
      specName: '默认规格',
      cost: 110,
      stock: 9,
      weightGram: 500,
    }])).rejects.toMatchObject({ status: 409 });

    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(tx.productSKU.create).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('rejects unsafe seller activation before updating product status', async () => {
    const inactive = { ...activeProduct(), status: 'INACTIVE' };
    const { service, tx, profitSafety } = buildHarness(inactive);
    let change: any;
    profitSafety.withCandidateChange.mockImplementationOnce(async (changeFactory: any) => {
      change = await changeFactory(tx);
      throw unsafe;
    });

    await expect(service.toggleStatus('company-1', 'product-1', 'ACTIVE'))
      .rejects.toBe(unsafe);

    expect(change).toEqual(expect.objectContaining({
      skuUpserts: [expect.objectContaining({ id: 'sku-1', active: true })],
    }));
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('routes draft submission through safety validation with exact persisted economics', async () => {
    const draft = validDraft();
    const { service, tx, profitSafety } = buildHarness(draft);
    let change: any;
    profitSafety.withCandidateChange.mockImplementationOnce(async (changeFactory: any) => {
      change = await changeFactory(tx);
      throw unsafe;
    });

    await expect(service.submitDraft('company-1', 'product-1'))
      .rejects.toBe(unsafe);

    expect(change).toEqual(expect.objectContaining({
      skuUpserts: [expect.objectContaining({
          id: 'sku-1',
          categoryId: 'category-old',
          price: 130,
          cost: 100,
          active: false,
      })],
    }));
    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('keeps draft-only edits outside the profit safety lock', async () => {
    const draft = validDraft();
    const { service, profitSafety } = buildHarness(draft);

    await service.updateDraft('company-1', 'product-1', { title: '仍是草稿' });

    expect(profitSafety.withCandidateChange).not.toHaveBeenCalled();
  });

  it('rebuilds a seller activation candidate under the lock after SKU economics changed', async () => {
    const inactive = { ...activeProduct(), status: 'INACTIVE' };
    const lockedProduct = {
      ...inactive,
      skus: [{ ...inactive.skus[0], price: 101, cost: 100 }],
    };
    const { service, prisma, tx, profitSafety } = buildHarness(inactive);
    prisma.product.findUnique.mockResolvedValue(inactive);
    tx.product.findUnique.mockResolvedValue(lockedProduct);
    let lockedChange: any;
    profitSafety.withCandidateChange.mockImplementation(async (changeOrFactory: any, write: any) => {
      lockedChange = typeof changeOrFactory === 'function'
        ? await changeOrFactory(tx)
        : changeOrFactory;
      return {
        result: await write(tx, {
          candidateSnapshot: { MARKUP_RATE: 1.3 },
          candidateSkus: lockedChange.skuUpserts,
          summary: { safe: true },
        }),
      };
    });

    await service.toggleStatus('company-1', 'product-1', 'ACTIVE');

    expect(lockedChange.skuUpserts).toEqual([
      expect.objectContaining({ id: 'sku-1', price: 101, cost: 100, active: true }),
    ]);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { status: 'ACTIVE' },
    });
  });

  it('routes a stale-INACTIVE seller SKU update through the lock and uses locked ACTIVE state', async () => {
    const inactive = { ...activeProduct(), status: 'INACTIVE' };
    const lockedProduct = activeProduct();
    const { service, prisma, tx, profitSafety } = buildHarness(inactive);
    prisma.product.findUnique.mockResolvedValue(inactive);
    tx.product.findUnique.mockResolvedValue(lockedProduct);
    let lockedChange: any;
    profitSafety.withCandidateChange.mockImplementation(async (changeFactory: any, write: any) => {
      lockedChange = await changeFactory(tx);
      return {
        result: await write(tx, {
          candidateSnapshot: { MARKUP_RATE: 1.3 },
          candidateSkus: lockedChange.skuUpserts,
          summary: { safe: true },
        }),
      };
    });

    await service.updateSkus('company-1', 'product-1', [{
      id: 'sku-1',
      specName: '默认规格',
      cost: 100,
      stock: 9,
      weightGram: 500,
    }]);

    expect(profitSafety.withCandidateChange).toHaveBeenCalledTimes(1);
    expect(lockedChange.skuUpserts).toEqual([
      expect.objectContaining({ id: 'sku-1', price: 130, cost: 100, active: true }),
    ]);
    expect(tx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'sku-1' },
      data: expect.objectContaining({ price: 130, cost: 100 }),
    });
  });

  it('routes a stale-INACTIVE category update through the lock and uses locked ACTIVE state', async () => {
    const inactive = { ...activeProduct(), status: 'INACTIVE' };
    const lockedProduct = activeProduct();
    const { service, prisma, tx, profitSafety } = buildHarness(inactive);
    prisma.product.findUnique.mockResolvedValue(inactive);
    tx.product.findUnique.mockResolvedValue(lockedProduct);
    let lockedChange: any;
    profitSafety.withCandidateChange.mockImplementation(async (changeFactory: any, write: any) => {
      lockedChange = await changeFactory(tx);
      return {
        result: await write(tx, {
          candidateSnapshot: { MARKUP_RATE: 1.3 },
          candidateSkus: lockedChange.skuUpserts,
          summary: { safe: true },
        }),
      };
    });

    await service.update('company-1', 'product-1', { categoryId: 'category-new' });

    expect(lockedChange.skuUpserts).toEqual([
      expect.objectContaining({ id: 'sku-1', categoryId: 'category-new', active: true }),
    ]);
    expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'product-1' },
      data: expect.objectContaining({ categoryId: 'category-new' }),
    }));
  });

  it('uses the locked draft cost for both candidate and submitted SKU price', async () => {
    const initialDraft = validDraft();
    const lockedDraft = {
      ...initialDraft,
      skus: [{ ...initialDraft.skus[0], cost: 110, price: 0 }],
    };
    const { service, prisma, tx, profitSafety } = buildHarness(initialDraft);
    prisma.product.findUnique.mockResolvedValue(initialDraft);
    tx.product.findUnique.mockResolvedValue(lockedDraft);
    let lockedChange: any;
    profitSafety.withCandidateChange.mockImplementation(async (changeOrFactory: any, write: any) => {
      lockedChange = typeof changeOrFactory === 'function'
        ? await changeOrFactory(tx)
        : changeOrFactory;
      return {
        result: await write(tx, {
          candidateSnapshot: { MARKUP_RATE: 1.3 },
          candidateSkus: lockedChange.skuUpserts,
          summary: { safe: true },
        }),
      };
    });

    await service.submitDraft('company-1', 'product-1');

    expect(lockedChange.skuUpserts).toEqual([
      expect.objectContaining({ id: 'sku-1', price: 143, cost: 110, active: false }),
    ]);
    expect(tx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'sku-1' },
      data: { price: 143 },
    });
  });
});
