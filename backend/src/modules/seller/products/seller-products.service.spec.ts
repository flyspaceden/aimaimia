import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductBundleService } from '../../product/product-bundle.service';
import { SellerProductsService } from './seller-products.service';

describe('SellerProductsService SKU weight validation', () => {
  const buildThrowingSellerBundleService = (message = '组合商品组成规格校验失败') => ({
    validateSellerBundleItems: jest.fn().mockRejectedValue(new BadRequestException(message)),
    calculateAvailability: jest.fn(),
    calculateTotalWeightGram: jest.fn(),
  });

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

  const buildDraftService = (productBundleService: any = new ProductBundleService()) => {
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
    const service = new SellerProductsService(
      prisma as any,
      bonusConfig as any,
      semanticFillService as any,
      productBundleService,
    );
    return { service, prisma, tx };
  };

  it('filters product list by product type before pagination', async () => {
    const prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      category: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const bonusConfig = { getSystemConfig: jest.fn() };
    const semanticFillService = { fillProduct: jest.fn().mockResolvedValue(undefined) };
    const service = new SellerProductsService(
      prisma as any,
      bonusConfig as any,
      semanticFillService as any,
      new ProductBundleService() as any,
    );

    await (service.findAll as any)('company_1', 2, 50, 'ACTIVE', undefined, '苹果', 'SIMPLE');

    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        companyId: 'company_1',
        status: 'ACTIVE',
        type: 'SIMPLE',
      }),
      skip: 50,
      take: 50,
    }));
    expect(prisma.product.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        companyId: 'company_1',
        status: 'ACTIVE',
        type: 'SIMPLE',
      }),
    });
  });

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

  const buildBundleCreateService = (
    skuRows = bundleValidationRows(),
    productBundleService: any = new ProductBundleService(),
  ) => {
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
      productBundleService,
    );
    return { service, prisma, tx };
  };

  const buildBundleToggleService = (options: {
    bundleItems?: Array<{ skuId: string; quantity: number; sortOrder?: number }>;
    componentRows?: any[];
  } = {}) => {
    const bundleItems = options.bundleItems ?? [
      { skuId: 'component_sku_1', quantity: 1, sortOrder: 0 },
    ];
    const componentRows = options.componentRows ?? bundleValidationRows().slice(0, 1);
    const tx = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'bundle_1',
          companyId: 'company_1',
          status: 'INACTIVE',
          auditStatus: 'APPROVED',
          type: 'BUNDLE',
          bundleItems,
        }),
        update: jest.fn().mockResolvedValue({ id: 'bundle_1', status: 'ACTIVE' }),
      },
      productBundleItem: {
        findMany: jest.fn().mockResolvedValue(bundleItems),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: bundleItems.length }),
      },
      productSKU: {
        findMany: jest.fn((args: any) => {
          if (args?.select?.product) {
            return Promise.resolve(componentRows);
          }
          return Promise.resolve(componentRows.map((row) => ({
            id: row.id,
            price: row.price,
            stock: row.stock,
            weightGram: row.weightGram,
          })));
        }),
      },
    };
    const prisma = {
      product: {
        findUnique: tx.product.findUnique,
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const service = new SellerProductsService(
      prisma as any,
      { getSystemConfig: jest.fn() } as any,
      { fillProduct: jest.fn().mockResolvedValue(undefined) } as any,
      new ProductBundleService() as any,
    );
    return { service, prisma, tx };
  };

  const buildBundleUpdateSkusService = (options: {
    productAuditStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
    bundleItems?: Array<{ skuId: string; quantity: number; sortOrder?: number }>;
    componentRows?: any[];
    existingSkus?: Array<Record<string, any>>;
  } = {}, productBundleService: any = new ProductBundleService()) => {
    const bundleItems = options.bundleItems ?? [
      { skuId: 'component_sku_1', quantity: 3, sortOrder: 4 },
      { skuId: 'component_sku_2', quantity: 1, sortOrder: 7 },
    ];
    const componentRows = options.componentRows ?? bundleValidationRows();
    const existingSkus = options.existingSkus ?? [
      {
        id: 'bundle_sku_active',
        title: '旧礼盒装',
        price: 19.5,
        cost: 15,
        stock: 0,
        weightGram: 1500,
        maxPerOrder: null,
        status: 'ACTIVE',
      },
      {
        id: 'bundle_sku_extra',
        title: '旧备用礼盒装',
        price: 21.45,
        cost: 16.5,
        stock: 0,
        weightGram: 1500,
        maxPerOrder: null,
        status: 'ACTIVE',
      },
      {
        id: 'bundle_sku_inactive',
        title: '历史礼盒装',
        price: 18.2,
        cost: 14,
        stock: 0,
        weightGram: 1200,
        maxPerOrder: null,
        status: 'INACTIVE',
      },
    ];
    const tx = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'bundle_1',
          companyId: 'company_1',
          status: 'INACTIVE',
          auditStatus: options.productAuditStatus ?? 'APPROVED',
          type: 'BUNDLE',
          bundleItems,
        }),
        update: jest.fn().mockResolvedValue({ id: 'bundle_1' }),
      },
      productBundleItem: {
        findMany: jest.fn().mockResolvedValue(bundleItems),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: bundleItems.length }),
      },
      productSKU: {
        findMany: jest.fn((args: any) => {
          if (args?.where?.productId) {
            const rows = args.where.status
              ? existingSkus.filter((sku) => sku.status === args.where.status)
              : existingSkus;
            if (args.select?.price) {
              return Promise.resolve(rows.map((sku) => ({ price: sku.price })));
            }
            return Promise.resolve(rows);
          }
          if (args?.select?.product) {
            return Promise.resolve(componentRows);
          }
          return Promise.resolve(componentRows.map((row) => ({
            id: row.id,
            price: row.price,
            stock: row.stock,
            weightGram: row.weightGram,
          })));
        }),
        update: jest.fn().mockResolvedValue({ id: 'bundle_sku_active' }),
        create: jest.fn().mockResolvedValue({ id: 'bundle_sku_created' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      product: {
        findUnique: tx.product.findUnique,
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const service = new SellerProductsService(
      prisma as any,
      { getSystemConfig: jest.fn().mockResolvedValue({ markupRate: 1.3 }) } as any,
      { fillProduct: jest.fn().mockResolvedValue(undefined) } as any,
      productBundleService,
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

  it('create wraps bundle validation errors onto bundleItems field', async () => {
    const productBundleService = buildThrowingSellerBundleService('组合商品组成规格必须为本商家在售普通商品');
    const { service } = buildBundleCreateService(bundleValidationRows(), productBundleService);

    await expect(service.create('company_1', {
      title: '水果礼盒',
      description: '组合商品描述需要足够长，确保通过校验。',
      categoryId: 'category_1',
      origin: { text: '山东烟台' },
      productType: 'BUNDLE',
      skus: [{ specName: '礼盒装', cost: 20, stock: 0, weightGram: 1 }],
      bundleItems: [{ skuId: 'component_sku_1', quantity: 1 }],
    } as any)).rejects.toMatchObject({
      response: {
        message: '组合商品组成规格必须为本商家在售普通商品',
        fieldErrors: [{ field: 'bundleItems', message: '组合商品组成规格必须为本商家在售普通商品' }],
      },
    });
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

  it('createDraft wraps bundle validation errors onto bundleItems field', async () => {
    const productBundleService = buildThrowingSellerBundleService('组合商品组成规格必须为本商家在售普通商品');
    const { service } = buildDraftService(productBundleService);

    await expect(service.createDraft('company_1', {
      title: '组合草稿',
      productType: 'BUNDLE',
      skus: [{ specName: '礼盒装', cost: 20 }],
      bundleItems: [{ skuId: 'component_sku_1', quantity: 1 }],
    } as any)).rejects.toMatchObject({
      response: {
        message: '组合商品组成规格必须为本商家在售普通商品',
        fieldErrors: [{ field: 'bundleItems', message: '组合商品组成规格必须为本商家在售普通商品' }],
      },
    });
  });

  it('updateDraft wraps bundle validation errors onto bundleItems field', async () => {
    const productBundleService = buildThrowingSellerBundleService('组合商品组成规格必须为本商家在售普通商品');
    const { service, tx } = buildDraftService(productBundleService);
    tx.product.findUnique.mockResolvedValueOnce({
      id: 'draft_1',
      companyId: 'company_1',
      status: 'DRAFT',
      type: 'BUNDLE',
    });

    await expect(service.updateDraft('company_1', 'draft_1', {
      productType: 'BUNDLE',
      bundleItems: [{ skuId: 'component_sku_1', quantity: 1 }],
    } as any)).rejects.toMatchObject({
      response: {
        message: '组合商品组成规格必须为本商家在售普通商品',
        fieldErrors: [{ field: 'bundleItems', message: '组合商品组成规格必须为本商家在售普通商品' }],
      },
    });
  });

  it('submitDraft wraps bundle validation errors onto bundleItems field', async () => {
    const productBundleService = buildThrowingSellerBundleService('组合商品组成规格必须为本商家在售普通商品');
    const { service, tx } = buildDraftService(productBundleService);
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
        skuCode: null,
      }],
      media: [],
      tags: [],
      bundleItems: [{ skuId: 'component_sku_1', quantity: 1, sortOrder: 0 }],
    });

    await expect(service.submitDraft('company_1', 'draft_1'))
      .rejects.toMatchObject({
        response: {
          message: '组合商品组成规格必须为本商家在售普通商品',
          fieldErrors: [{ field: 'bundleItems', message: '组合商品组成规格必须为本商家在售普通商品' }],
        },
      });
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

  it('toggleStatus rejects ACTIVE for BUNDLE when persisted component is no longer sellable', async () => {
    const { service, prisma, tx } = buildBundleToggleService({
      componentRows: [{
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
          status: 'INACTIVE',
          auditStatus: 'APPROVED',
          type: 'SIMPLE',
        },
      }],
    });

    await expect(service.toggleStatus('company_1', 'bundle_1', 'ACTIVE'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('toggleStatus rejects ACTIVE for BUNDLE when persisted bundleItems are missing', async () => {
    const { service, tx } = buildBundleToggleService({
      bundleItems: [],
    });

    await expect(service.toggleStatus('company_1', 'bundle_1', 'ACTIVE'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('updateSkus rejects multiple selling SKUs for BUNDLE products', async () => {
    const { service, tx } = buildBundleUpdateSkusService();

    await expect(service.updateSkus('company_1', 'bundle_1', [
      { id: 'bundle_sku_active', specName: '礼盒装', cost: 20, stock: 99, weightGram: 1 },
      { specName: '礼盒装-备用', cost: 22, stock: 88, weightGram: 2 },
    ])).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(tx.productSKU.create).not.toHaveBeenCalled();
  });

  it('updateSkus lets BUNDLE selling SKU omit weightGram and derives weight from bundle components', async () => {
    const { service, tx } = buildBundleUpdateSkusService();

    await service.updateSkus('company_1', 'bundle_1', [
      {
        id: 'bundle_sku_active',
        specName: '新礼盒装',
        cost: 20,
        stock: 99,
        maxPerOrder: 3,
      },
    ]);

    expect(tx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'bundle_sku_active' },
      data: expect.objectContaining({
        title: '新礼盒装',
        price: 26,
        cost: 20,
        stock: 0,
        weightGram: 1800,
        maxPerOrder: 3,
      }),
    });
    expect(tx.productSKU.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['bundle_sku_extra'] } },
      data: { status: 'INACTIVE' },
    });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'bundle_1' },
      data: {
        basePrice: 26,
        cost: 20,
        auditStatus: 'PENDING',
        auditNote: null,
        submissionCount: { increment: 1 },
      },
    });
  });

  it('updateSkus ignores caller-provided BUNDLE weightGram and keeps component-derived weight', async () => {
    const { service, tx } = buildBundleUpdateSkusService();

    await service.updateSkus('company_1', 'bundle_1', [
      {
        id: 'bundle_sku_active',
        specName: '新礼盒装',
        cost: 20,
        stock: 99,
        weightGram: 1,
      },
    ]);

    expect(tx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'bundle_sku_active' },
      data: expect.objectContaining({
        weightGram: 1800,
      }),
    });
  });

  it('update atomically updates BUNDLE bundleItems and the single selling SKU', async () => {
    const { service, prisma, tx } = buildBundleUpdateSkusService();
    (prisma.product.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 'bundle_1',
        companyId: 'company_1',
        status: 'INACTIVE',
        auditStatus: 'APPROVED',
        type: 'BUNDLE',
      })
      .mockResolvedValueOnce({
        id: 'bundle_1',
        companyId: 'company_1',
        type: 'BUNDLE',
        skus: [],
        media: [],
        tags: [],
        category: null,
        bundleItems: [
          {
            skuId: 'component_sku_1',
            quantity: 1,
            sortOrder: 0,
            sku: { id: 'component_sku_1', price: 12, stock: 9, weightGram: 500, product: { media: [] } },
          },
          {
            skuId: 'component_sku_2',
            quantity: 2,
            sortOrder: 1,
            sku: { id: 'component_sku_2', price: 8, stock: 5, weightGram: 300, product: { media: [] } },
          },
        ],
      });

    await service.update('company_1', 'bundle_1', {
      title: '新水果礼盒',
      productType: 'BUNDLE',
      bundleItems: [
        { skuId: 'component_sku_1', quantity: 1, sortOrder: 0 },
        { skuId: 'component_sku_2', quantity: 2, sortOrder: 1 },
      ],
      skus: [{
        id: 'bundle_sku_active',
        specName: '新礼盒装',
        cost: 22,
        stock: 99,
        weightGram: 1,
        maxPerOrder: 2,
      }],
    } as any);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.productBundleItem.deleteMany).toHaveBeenCalledWith({
      where: { bundleProductId: 'bundle_1' },
    });
    expect(tx.productBundleItem.createMany).toHaveBeenCalledWith({
      data: [
        { skuId: 'component_sku_1', quantity: 1, sortOrder: 0, bundleProductId: 'bundle_1' },
        { skuId: 'component_sku_2', quantity: 2, sortOrder: 1, bundleProductId: 'bundle_1' },
      ],
    });
    expect(tx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'bundle_sku_active' },
      data: expect.objectContaining({
        title: '新礼盒装',
        price: 28.6,
        cost: 22,
        stock: 0,
        weightGram: 1100,
        maxPerOrder: 2,
      }),
    });
    expect(tx.productSKU.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['bundle_sku_extra'] } },
      data: { status: 'INACTIVE' },
    });
    expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bundle_1' },
      data: expect.objectContaining({
        basePrice: 28.6,
        cost: 22,
      }),
    }));
  });

  it('update wraps bundle validation errors onto bundleItems field', async () => {
    const productBundleService = buildThrowingSellerBundleService('组合商品组成规格必须为本商家在售普通商品');
    const { service, prisma } = buildBundleUpdateSkusService({}, productBundleService);
    (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'bundle_1',
      companyId: 'company_1',
      status: 'INACTIVE',
      auditStatus: 'APPROVED',
      type: 'BUNDLE',
    });

    await expect(service.update('company_1', 'bundle_1', {
      title: '新水果礼盒',
      productType: 'BUNDLE',
      bundleItems: [{ skuId: 'component_sku_1', quantity: 1, sortOrder: 0 }],
      skus: [{ id: 'bundle_sku_active', specName: '新礼盒装', cost: 22, stock: 0, weightGram: 1 }],
    } as any)).rejects.toMatchObject({
      response: {
        message: '组合商品组成规格必须为本商家在售普通商品',
        fieldErrors: [{ field: 'bundleItems', message: '组合商品组成规格必须为本商家在售普通商品' }],
      },
    });
  });
});
