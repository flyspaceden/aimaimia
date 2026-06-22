import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductBundleService } from '../../product/product-bundle.service';
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
          type: 'SIMPLE',
        }),
      },
      $transaction: jest.fn(),
    };
    const bonusConfig = { getSystemConfig: jest.fn() };
    const semanticFillService = { fillProduct: jest.fn().mockResolvedValue(undefined) };
    const productBundleService = new ProductBundleService();
    return new SellerProductsService(
      prisma as any,
      bonusConfig as any,
      semanticFillService as any,
      productBundleService as any,
    );
  };

  const buildDraftService = () => {
    const tx = {
      product: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          id: 'draft_1',
          companyId: 'company_1',
          title: '草稿商品',
          skus: [],
          media: [],
        }),
        update: jest.fn().mockResolvedValue({ id: 'draft_1' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'draft_1',
          companyId: 'company_1',
          status: 'DRAFT',
          type: 'SIMPLE',
          skus: [],
          media: [],
          tags: [],
          bundleItems: [],
        }),
      },
      productSKU: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'sku_bundle' }),
        update: jest.fn().mockResolvedValue({ id: 'sku_1' }),
      },
      productBundleItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      productMedia: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      productTag: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      tag: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'draft_1',
          companyId: 'company_1',
          status: 'DRAFT',
          type: 'SIMPLE',
          skus: [],
          media: [],
          tags: [],
          bundleItems: [],
        }),
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const bonusConfig = { getSystemConfig: jest.fn().mockResolvedValue({ markupRate: 1.3 }) };
    const semanticFillService = { fillProduct: jest.fn().mockResolvedValue(undefined) };
    const productBundleService = new ProductBundleService();
    const service = new SellerProductsService(
      prisma as any,
      bonusConfig as any,
      semanticFillService as any,
      productBundleService as any,
    );
    return { service, prisma, tx };
  };

  const bundleValidationRows = (overrides: Array<Record<string, any>> = []) => ([
    {
      id: 'component_sku_1',
      title: '苹果 5斤',
      price: 12,
      stock: 9,
      weightGram: 500,
      status: 'ACTIVE',
      product: {
        id: 'component_product_1',
        title: '苹果',
        companyId: 'company_1',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        type: 'SIMPLE',
      },
    },
    {
      id: 'component_sku_2',
      title: '梨 3斤',
      price: 8,
      stock: 5,
      weightGram: 300,
      status: 'ACTIVE',
      product: {
        id: 'component_product_2',
        title: '梨',
        companyId: 'company_1',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        type: 'SIMPLE',
      },
    },
    ...overrides,
  ]);

  const buildBundleCreateService = (skuRows = bundleValidationRows()) => {
    const tx = {
      product: {
        create: jest.fn().mockResolvedValue({
          id: 'bundle_1',
          companyId: 'company_1',
          title: '水果礼盒',
          attributes: null,
          skus: [],
          media: [],
          bundleItems: [],
        }),
        update: jest.fn().mockResolvedValue({ id: 'bundle_1' }),
      },
      productSKU: {
        findMany: jest.fn().mockResolvedValue(skuRows),
      },
      tag: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      productTag: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'bundle_1',
          companyId: 'company_1',
          type: 'BUNDLE',
          skus: [{ id: 'bundle_sku_1', title: '礼盒装', price: 26, cost: 20, stock: 0, weightGram: 1800 }],
          media: [],
          tags: [],
          category: null,
          bundleItems: [
            {
              skuId: 'component_sku_1',
              quantity: 3,
              sortOrder: 4,
              sku: {
                id: 'component_sku_1',
                price: 12,
                stock: 9,
                weightGram: 500,
                product: { media: [] },
              },
            },
            {
              skuId: 'component_sku_2',
              quantity: 1,
              sortOrder: 7,
              sku: {
                id: 'component_sku_2',
                price: 8,
                stock: 5,
                weightGram: 300,
                product: { media: [] },
              },
            },
          ],
        }),
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const bonusConfig = { getSystemConfig: jest.fn().mockResolvedValue({ markupRate: 1.3 }) };
    const semanticFillService = { fillProduct: jest.fn().mockResolvedValue(undefined) };
    const service = new SellerProductsService(
      prisma as any,
      bonusConfig as any,
      semanticFillService as any,
      new ProductBundleService() as any,
    );
    return { service, prisma, tx };
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

  it('createDraft writes unique placeholder skuCode values for multiple SKUs without weight', async () => {
    const { service, tx } = buildDraftService();

    await service.createDraft('company_1', {
      title: '草稿商品',
      skus: [
        { specName: '小份', cost: 10, stock: 5 },
        { specName: '大份', cost: 20, stock: 3 },
      ],
    });

    const createArg = tx.product.create.mock.calls[0][0];
    const skuCreates = createArg.data.skus.create;
    expect(skuCreates).toHaveLength(2);
    expect(skuCreates[0].skuCode).toMatch(/^__DRAFT_WEIGHT_PLACEHOLDER__:/);
    expect(skuCreates[1].skuCode).toMatch(/^__DRAFT_WEIGHT_PLACEHOLDER__:/);
    expect(skuCreates[0].skuCode).not.toBe(skuCreates[1].skuCode);
    expect(skuCreates[0].weightGram).toBe(1000);
    expect(skuCreates[1].weightGram).toBe(1000);
  });

  it('submitDraft rejects SKU with placeholder skuCode prefix', async () => {
    const { service, tx } = buildDraftService();
    tx.product.findUnique.mockResolvedValueOnce({
      id: 'draft_1',
      companyId: 'company_1',
      status: 'DRAFT',
      title: '草稿商品',
      subtitle: null,
      description: '这是一段足够长的商品描述',
      categoryId: 'category_1',
      returnPolicy: 'INHERIT',
      origin: { text: '山东烟台' },
      attributes: null,
      aiKeywords: [],
      flavorTags: [],
      seasonalMonths: [],
      usageScenarios: [],
      dietaryTags: [],
      originRegion: '山东烟台',
      skus: [{
        id: 'sku_1',
        title: '默认规格',
        cost: 10,
        stock: 5,
        maxPerOrder: null,
        weightGram: 1000,
        skuCode: '__DRAFT_WEIGHT_PLACEHOLDER__:abc',
      }],
      media: [],
      tags: [],
    });

    await expect(service.submitDraft('company_1', 'draft_1'))
      .rejects.toMatchObject({
        response: expect.objectContaining({
          message: '提交前请补全以下字段：规格(包装后重量（克）)',
        }),
      });
  });

  it('submitDraft rejects placeholder SKU from the Serializable transaction snapshot without writing', async () => {
    const { service, prisma, tx } = buildDraftService();
    const cleanDraft = {
      id: 'draft_1',
      companyId: 'company_1',
      status: 'DRAFT',
      title: '草稿商品',
      subtitle: null,
      description: '这是一段足够长的商品描述',
      categoryId: 'category_1',
      returnPolicy: 'INHERIT',
      origin: { text: '山东烟台' },
      attributes: null,
      aiKeywords: [],
      flavorTags: [],
      seasonalMonths: [],
      usageScenarios: [],
      dietaryTags: [],
      originRegion: '山东烟台',
      skus: [{
        id: 'sku_1',
        title: '默认规格',
        cost: 10,
        stock: 5,
        maxPerOrder: null,
        weightGram: 1000,
        skuCode: null,
      }],
      media: [],
      tags: [],
    };
    tx.product.findUnique.mockResolvedValueOnce({
      ...cleanDraft,
      skus: [{
        ...cleanDraft.skus[0],
        skuCode: '__DRAFT_WEIGHT_PLACEHOLDER__:raced',
      }],
    });

    await expect(service.submitDraft('company_1', 'draft_1'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('updateDraft clears placeholder skuCode when user fills real weightGram', async () => {
    const { service, tx } = buildDraftService();

    await service.updateDraft('company_1', 'draft_1', {
      skus: [{
        specName: '默认规格',
        cost: 10,
        stock: 5,
        weightGram: 750,
      }],
    });

    const createManyArg = tx.productSKU.createMany.mock.calls[0][0];
    expect(createManyArg.data[0].weightGram).toBe(750);
    expect(createManyArg.data[0].skuCode).toBeUndefined();
  });

  it('updateDraft rejects non-DRAFT from the Serializable transaction snapshot without writing', async () => {
    const { service, prisma, tx } = buildDraftService();
    tx.product.findUnique.mockResolvedValueOnce({
      id: 'draft_1',
      companyId: 'company_1',
      status: 'ACTIVE',
    });

    await expect(service.updateDraft('company_1', 'draft_1', {
      title: '不能覆盖正式商品',
      skus: [{ specName: '默认规格', cost: 10, stock: 5, weightGram: 750 }],
      mediaUrls: ['https://example.com/a.jpg'],
      tagIds: ['tag_1'],
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.productSKU.deleteMany).not.toHaveBeenCalled();
    expect(tx.productSKU.createMany).not.toHaveBeenCalled();
    expect(tx.productMedia.deleteMany).not.toHaveBeenCalled();
    expect(tx.productTag.deleteMany).not.toHaveBeenCalled();
    expect(tx.productTag.createMany).not.toHaveBeenCalled();
  });

  it('creates BUNDLE product with one selling SKU, zero stock, and normalized bundleItems', async () => {
    const { service, tx } = buildBundleCreateService();

    await service.create('company_1', {
      title: '水果礼盒',
      description: '组合商品描述需要足够长，确保通过校验。',
      categoryId: 'category_1',
      origin: { text: '山东烟台' },
      productType: 'BUNDLE',
      skus: [{
        specName: '礼盒装',
        cost: 20,
        stock: 99,
        weightGram: 1,
      }],
      bundleItems: [
        { skuId: 'component_sku_1', quantity: 1, sortOrder: 4 },
        { skuId: 'component_sku_1', quantity: 2, sortOrder: 9 },
        { skuId: 'component_sku_2', quantity: 1, sortOrder: 7 },
      ],
    } as any);

    const createArg = tx.product.create.mock.calls[0][0];
    expect(createArg.data.type).toBe('BUNDLE');
    expect(createArg.data.skus.create).toHaveLength(1);
    expect(createArg.data.skus.create[0]).toMatchObject({
      title: '礼盒装',
      cost: 20,
      price: 26,
      stock: 0,
      weightGram: 1800,
    });
    expect(createArg.data.bundleItems.create).toEqual([
      { skuId: 'component_sku_1', quantity: 3, sortOrder: 4 },
      { skuId: 'component_sku_2', quantity: 1, sortOrder: 7 },
    ]);
  });

  it('create rejects cross-company bundle component SKU', async () => {
    const { service, tx } = buildBundleCreateService(bundleValidationRows([
      {
        id: 'foreign_sku',
        title: '外部商品',
        price: 15,
        stock: 10,
        weightGram: 200,
        status: 'ACTIVE',
        product: {
          id: 'foreign_product',
          title: '外部商品',
          companyId: 'company_2',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          type: 'SIMPLE',
        },
      },
    ]));

    await expect(service.create('company_1', {
      title: '水果礼盒',
      description: '组合商品描述需要足够长，确保通过校验。',
      categoryId: 'category_1',
      origin: { text: '山东烟台' },
      productType: 'BUNDLE',
      skus: [{ specName: '礼盒装', cost: 20, stock: 0, weightGram: 1 }],
      bundleItems: [{ skuId: 'foreign_sku', quantity: 1 }],
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.product.create).not.toHaveBeenCalled();
  });

  it('create rejects bundle component whose product type is BUNDLE', async () => {
    const { service, tx } = buildBundleCreateService(bundleValidationRows([
      {
        id: 'nested_bundle_sku',
        title: '套娃礼盒',
        price: 30,
        stock: 2,
        weightGram: 400,
        status: 'ACTIVE',
        product: {
          id: 'nested_bundle_product',
          title: '套娃礼盒',
          companyId: 'company_1',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          type: 'BUNDLE',
        },
      },
    ]));

    await expect(service.create('company_1', {
      title: '水果礼盒',
      description: '组合商品描述需要足够长，确保通过校验。',
      categoryId: 'category_1',
      origin: { text: '山东烟台' },
      productType: 'BUNDLE',
      skus: [{ specName: '礼盒装', cost: 20, stock: 0, weightGram: 1 }],
      bundleItems: [{ skuId: 'nested_bundle_sku', quantity: 1 }],
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.product.create).not.toHaveBeenCalled();
  });

  it('createDraft allows incomplete BUNDLE but submitDraft rejects missing valid bundleItems', async () => {
    const { service, tx } = buildDraftService();

    await service.createDraft('company_1', {
      title: '组合草稿',
      productType: 'BUNDLE',
      skus: [{ specName: '礼盒装', cost: 20 }],
    } as any);

    const createArg = tx.product.create.mock.calls[0][0];
    expect(createArg.data.type).toBe('BUNDLE');

    tx.product.findUnique.mockResolvedValueOnce({
      id: 'draft_1',
      companyId: 'company_1',
      status: 'DRAFT',
      type: 'BUNDLE',
      title: '组合草稿',
      subtitle: null,
      description: '这是一段足够长的商品描述',
      categoryId: 'category_1',
      returnPolicy: 'INHERIT',
      origin: { text: '山东烟台' },
      attributes: null,
      aiKeywords: [],
      flavorTags: [],
      seasonalMonths: [],
      usageScenarios: [],
      dietaryTags: [],
      originRegion: '山东烟台',
      skus: [{
        id: 'draft_bundle_sku',
        title: '礼盒装',
        cost: 20,
        stock: 0,
        maxPerOrder: null,
        weightGram: 1000,
        skuCode: '__DRAFT_WEIGHT_PLACEHOLDER__:bundle',
      }],
      media: [],
      tags: [],
      bundleItems: [],
    });

    await expect(service.submitDraft('company_1', 'draft_1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateSkus rejects removing a SIMPLE SKU referenced by non-DRAFT bundle products', async () => {
    const tx = {
      productSKU: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'sku_keep', price: 13, status: 'ACTIVE' },
          { id: 'sku_remove', price: 15, status: 'ACTIVE' },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'sku_keep' }),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      productBundleItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'bundle_item_1',
          bundleProduct: { id: 'bundle_1', status: 'INACTIVE' },
        }),
      },
      product: {
        update: jest.fn(),
      },
    };
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product_1',
          companyId: 'company_1',
          status: 'INACTIVE',
          auditStatus: 'PENDING',
          type: 'SIMPLE',
        }),
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const service = new SellerProductsService(
      prisma as any,
      { getSystemConfig: jest.fn().mockResolvedValue({ markupRate: 1.3 }) } as any,
      { fillProduct: jest.fn().mockResolvedValue(undefined) } as any,
      new ProductBundleService() as any,
    );

    await expect(service.updateSkus('company_1', 'product_1', [
      { id: 'sku_keep', specName: '保留规格', cost: 10, stock: 5, weightGram: 500 },
    ])).rejects.toMatchObject({
      response: { message: '该规格已被组合商品引用，请先修改组合商品' },
    });

    expect(tx.productSKU.updateMany).not.toHaveBeenCalled();
  });
});
