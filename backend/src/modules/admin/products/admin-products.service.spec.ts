import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { ProductBundleService } from '../../product/product-bundle.service';
import { AdminProductsService } from './admin-products.service';
import { SkuUpdateItem, UpdateProductSkusDto } from './dto/update-sku.dto';

const passthroughProfitSafety = (prisma: any) => ({
  withCandidateChange: jest.fn(async (_change: unknown, write: (tx: any) => Promise<unknown>) => ({
    result: await prisma.$transaction(write, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }),
  })),
});

describe('AdminProductsService SKU weight validation', () => {
  const buildService = () => {
    const tx = {
      productSKU: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'sku_1' }])
          .mockResolvedValueOnce([{ price: 18 }])
          .mockResolvedValueOnce([{ id: 'sku_1', weightGram: 650 }]),
        update: jest.fn().mockResolvedValue({ id: 'sku_1' }),
        create: jest.fn().mockResolvedValue({ id: 'sku_2' }),
      },
      product: {
        update: jest.fn().mockResolvedValue({ id: 'product_1' }),
      },
    };
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product_1',
          companyId: 'company_1',
          categoryId: 'category_1',
          status: 'ACTIVE',
          company: { isPlatform: false },
          lotteryPrizes: [],
          skus: [{
            id: 'sku_1',
            price: 18,
            cost: 10,
            status: 'ACTIVE',
            vipGiftItems: [],
          }],
        }),
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };

    return {
      service: new AdminProductsService(
        prisma as any,
        new ProductBundleService(),
        passthroughProfitSafety(prisma) as any,
      ),
      prisma,
      tx,
    };
  };

  it('DTO rejects SKU update items without weightGram', async () => {
    const dto = plainToInstance(UpdateProductSkusDto, {
      skus: [{
        id: 'sku_1',
        specText: '默认规格',
        price: 18,
        stock: 5,
      }],
    });

    const errors = await validate(dto);
    const skuErrors = errors.find((error) => error.property === 'skus');

    expect(JSON.stringify(skuErrors)).toContain('weightGram');
  });

  it('DTO rejects non-positive SKU weights with a Chinese message', async () => {
    const dto = plainToInstance(SkuUpdateItem, {
      id: 'sku_1',
      specText: '默认规格',
      price: 18,
      stock: 5,
      weightGram: 0,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'weightGram')).toBe(true);
    expect(JSON.stringify(errors)).toContain('SKU 重量必须大于 0 克');
  });

  it('DTO rejects non-positive maxPerOrder values', async () => {
    const dto = plainToInstance(SkuUpdateItem, {
      id: 'sku_1',
      specText: '默认规格',
      price: 18,
      stock: 5,
      weightGram: 650,
      maxPerOrder: 0,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'maxPerOrder')).toBe(true);
  });

  it('rejects missing weightGram in service before writing SKU changes', async () => {
    const { service, tx } = buildService();

    await expect(service.updateSkus('product_1', {
      skus: [{
        id: 'sku_1',
        specText: '默认规格',
        price: 18,
        stock: 5,
      } as any],
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.productSKU.update).not.toHaveBeenCalled();
    expect(tx.productSKU.create).not.toHaveBeenCalled();
  });

  it('writes provided weightGram for existing and new SKUs in a Serializable transaction', async () => {
    const { service, prisma, tx } = buildService();

    await service.updateSkus('product_1', {
      skus: [
        {
          id: 'sku_1',
          specText: '默认规格',
          price: 18,
          stock: 5,
          weightGram: 650,
        },
        {
          specText: '新增规格',
          price: 28,
          cost: 12,
          stock: 3,
          weightGram: 900,
        },
      ],
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.productSKU.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sku_1' },
      data: expect.objectContaining({ weightGram: 650 }),
    }));
    expect(tx.productSKU.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ weightGram: 900 }),
    }));
  });

  it('writes maxPerOrder for existing and new SKUs', async () => {
    const { service, tx } = buildService();

    await service.updateSkus('product_1', {
      skus: [
        {
          id: 'sku_1',
          specText: '默认规格',
          price: 18,
          stock: 5,
          weightGram: 650,
          maxPerOrder: 3,
        } as any,
        {
          specText: '新增规格',
          price: 28,
          cost: 12,
          stock: 3,
          weightGram: 900,
          maxPerOrder: undefined,
        } as any,
      ],
    });

    expect(tx.productSKU.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sku_1' },
      data: expect.objectContaining({ maxPerOrder: 3 }),
    }));
    expect(tx.productSKU.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ maxPerOrder: null }),
    }));
  });
});

describe('AdminProductsService bundle review reads and audit', () => {
  const createBundleItem = (overrides: Partial<any> = {}) => ({
    skuId: 'component_sku_1',
    quantity: 2,
    sortOrder: 0,
    sku: {
      id: 'component_sku_1',
      title: '苹果 5斤',
      price: 12.5,
      cost: 8,
      stock: 9,
      weightGram: 500,
      status: 'ACTIVE',
      product: {
        id: 'component_product_1',
        title: '烟台苹果',
        companyId: 'company_1',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        type: 'SIMPLE',
      },
    },
    ...overrides,
  });

  const createBundleProduct = (overrides: Partial<any> = {}) => ({
    id: 'bundle_1',
    companyId: 'company_1',
    status: 'INACTIVE',
    auditStatus: 'PENDING',
    type: 'BUNDLE',
    company: { id: 'company_1', name: '果园' },
    category: { id: 'cat_1', name: '礼盒', returnPolicy: 'RETURNABLE', parentId: null },
    skus: [{ id: 'bundle_sku_1', price: 39.9, cost: 20, stock: 0, maxPerOrder: 2 }],
    media: [{ url: 'https://example.com/bundle.jpg' }],
    tags: [],
    bundleItems: [
      createBundleItem(),
      createBundleItem({
        skuId: 'component_sku_2',
        quantity: 1,
        sortOrder: 1,
        sku: {
          id: 'component_sku_2',
          title: '梨 3斤',
          price: 8,
          cost: 5,
          stock: 4,
          weightGram: 300,
          status: 'ACTIVE',
          product: {
            id: 'component_product_2',
            title: '皇冠梨',
            companyId: 'company_1',
            status: 'ACTIVE',
            auditStatus: 'APPROVED',
            type: 'SIMPLE',
          },
        },
      }),
    ],
    ...overrides,
  });

  const createSimpleProduct = (overrides: Partial<any> = {}) => ({
    id: 'simple_1',
    companyId: 'company_1',
    status: 'ACTIVE',
    auditStatus: 'APPROVED',
    type: 'SIMPLE',
    company: { id: 'company_1', name: '果园' },
    category: { id: 'cat_1', name: '水果', returnPolicy: 'RETURNABLE', parentId: null },
    skus: [{ id: 'simple_sku_1', price: 19.9, cost: 10, stock: 11, maxPerOrder: 2 }],
    media: [{ url: 'https://example.com/simple.jpg' }],
    tags: [],
    bundleItems: [],
    ...overrides,
  });

  const buildBundleReviewService = (options: {
    listItems?: any[];
    detailProduct?: any;
    auditProduct?: any;
    updateResult?: any;
    persistedBundleItems?: any[];
    componentRows?: any[];
    statusGroups?: Array<{ status: string; _count: number }>;
    auditGroups?: Array<{ auditStatus: string; _count: number }>;
  } = {}) => {
    const tx = {
      product: {
        findUnique: jest.fn().mockResolvedValue(options.auditProduct ?? createBundleProduct()),
        update: jest.fn().mockResolvedValue(
          options.updateResult ?? { id: 'bundle_1', auditStatus: 'APPROVED', status: 'ACTIVE' },
        ),
      },
      productBundleItem: {
        findMany: jest.fn().mockResolvedValue(options.persistedBundleItems ?? [
          { skuId: 'component_sku_1', quantity: 2, sortOrder: 0 },
          { skuId: 'component_sku_2', quantity: 1, sortOrder: 1 },
        ]),
      },
      productSKU: {
        findMany: jest.fn().mockResolvedValue(options.componentRows ?? [
          {
            id: 'component_sku_1',
            title: '苹果 5斤',
            weightGram: 500,
            status: 'ACTIVE',
            product: {
              id: 'component_product_1',
              title: '烟台苹果',
              companyId: 'company_1',
              status: 'ACTIVE',
              auditStatus: 'APPROVED',
              type: 'SIMPLE',
            },
          },
          {
            id: 'component_sku_2',
            title: '梨 3斤',
            weightGram: 300,
            status: 'ACTIVE',
            product: {
              id: 'component_product_2',
              title: '皇冠梨',
              companyId: 'company_1',
              status: 'ACTIVE',
              auditStatus: 'APPROVED',
              type: 'SIMPLE',
            },
          },
        ]),
      },
    };

    const prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue(options.listItems ?? [createBundleProduct()]),
        count: jest.fn().mockResolvedValue((options.listItems ?? [createBundleProduct()]).length),
        findUnique: jest.fn().mockResolvedValue(options.detailProduct ?? createBundleProduct()),
        update: jest.fn().mockResolvedValue(options.updateResult ?? { id: 'bundle_1', auditStatus: 'APPROVED', status: 'ACTIVE' }),
        groupBy: jest
          .fn()
          .mockImplementation(({ by }: { by: Array<'status' | 'auditStatus'> }) => {
            if (by.includes('status')) {
              return Promise.resolve(options.statusGroups ?? [
                { status: 'ACTIVE', _count: 2 },
                { status: 'INACTIVE', _count: 1 },
              ]);
            }
            return Promise.resolve(options.auditGroups ?? [
              { auditStatus: 'APPROVED', _count: 2 },
              { auditStatus: 'PENDING', _count: 1 },
            ]);
          }),
      },
      category: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((fn: any, _opts?: any) => fn(tx)),
    };

    return {
      service: new AdminProductsService(
        prisma as any,
        new ProductBundleService(),
        passthroughProfitSafety(prisma) as any,
      ),
      prisma,
      tx,
    };
  };

  it('returns bundleItems on product detail for admin review', async () => {
    const { service, prisma } = buildBundleReviewService();

    const result = await service.findAll();
    const product = await service.findById('bundle_1');

    expect(prisma.product.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        bundleItems: expect.any(Object),
      }),
    }));
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        bundleItems: expect.any(Object),
      }),
    }));
    expect(result.items[0].bundleItems).toHaveLength(2);
    expect(product.bundleItems).toHaveLength(2);
    expect(product.bundleItems[0]).toMatchObject({
      skuId: 'component_sku_1',
      quantity: 2,
      sku: {
        id: 'component_sku_1',
        title: '苹果 5斤',
        product: { id: 'component_product_1', title: '烟台苹果' },
      },
    });
  });

  it('returns derived bundle review fields on product detail', async () => {
    const { service } = buildBundleReviewService();

    const product = await service.findById('bundle_1');

    expect(product).toMatchObject({
      bundleReferenceTotal: 33,
      bundleTotalWeightGram: 1300,
      bundleAvailableStock: 4,
    });
  });

  it('does not expose DRAFT bundle products in admin list and detail as before', async () => {
    const draftBundle = createBundleProduct({ id: 'bundle_draft', status: 'DRAFT' });
    const { service, prisma } = buildBundleReviewService({
      listItems: [draftBundle],
      detailProduct: draftBundle,
    });

    const result = await service.findAll(1, 20, 'DRAFT');

    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { not: 'DRAFT' } }),
      include: expect.objectContaining({
        bundleItems: expect.any(Object),
      }),
    }));
    expect(result.page).toBe(1);
    await expect(service.findById('bundle_draft')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns bundle reference total and total weight for review display', async () => {
    const { service } = buildBundleReviewService();

    const result = await service.findAll();

    expect(result.items[0]).toMatchObject({
      bundleReferenceTotal: 33,
      bundleTotalWeightGram: 1300,
      bundleAvailableStock: 4,
    });
  });

  it('excludes DRAFT bundle products from stats aggregation', async () => {
    const { service, prisma } = buildBundleReviewService({
      statusGroups: [
        { status: 'ACTIVE', _count: 2 },
        { status: 'INACTIVE', _count: 1 },
      ],
      auditGroups: [
        { auditStatus: 'APPROVED', _count: 2 },
        { auditStatus: 'PENDING', _count: 1 },
      ],
    });

    const stats = await service.getStats();

    expect(prisma.product.groupBy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      by: ['status'],
      where: { status: { not: 'DRAFT' } },
    }));
    expect(prisma.product.groupBy).toHaveBeenNthCalledWith(2, expect.objectContaining({
      by: ['auditStatus'],
      where: { status: { not: 'DRAFT' } },
    }));
    expect(stats.ALL).toBe(3);
  });

  it('rejects BUNDLE audit approval when persisted bundle components are missing', async () => {
    const { service, tx, prisma } = buildBundleReviewService({
      persistedBundleItems: [],
    });

    await expect(service.audit('bundle_1', 'APPROVED', '通过')).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('rejects BUNDLE audit approval when a persisted component is inactive or unapproved', async () => {
    const { service, tx } = buildBundleReviewService({
      componentRows: [
        {
          id: 'component_sku_1',
          title: '苹果 5斤',
          weightGram: 500,
          status: 'INACTIVE',
          product: {
            id: 'component_product_1',
            title: '烟台苹果',
            companyId: 'company_1',
            status: 'INACTIVE',
            auditStatus: 'PENDING',
            type: 'SIMPLE',
          },
        },
      ],
    });

    await expect(service.audit('bundle_1', 'APPROVED')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('rejects BUNDLE audit approval when a persisted component is another bundle', async () => {
    const { service, tx } = buildBundleReviewService({
      componentRows: [
        {
          id: 'component_sku_1',
          title: '礼盒组件',
          weightGram: 500,
          status: 'ACTIVE',
          product: {
            id: 'component_product_1',
            title: '礼盒A',
            companyId: 'company_1',
            status: 'ACTIVE',
            auditStatus: 'APPROVED',
            type: 'BUNDLE',
          },
        },
      ],
    });

    await expect(service.audit('bundle_1', 'APPROVED')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('keeps SIMPLE review reads and audit approval behavior unchanged', async () => {
    const simpleProduct = createSimpleProduct();
    const { service, tx } = buildBundleReviewService({
      listItems: [simpleProduct],
      detailProduct: simpleProduct,
      auditProduct: simpleProduct,
      updateResult: { id: 'simple_1', auditStatus: 'APPROVED', status: 'ACTIVE' },
    });

    const listResult = await service.findAll();
    const approved = await service.audit('simple_1', 'APPROVED', '通过');

    expect(listResult.items[0]).toMatchObject({
      id: 'simple_1',
      bundleReferenceTotal: null,
      bundleAvailableStock: null,
      bundleTotalWeightGram: null,
    });
    expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'simple_1' },
      data: expect.objectContaining({
        auditStatus: 'APPROVED',
        status: 'ACTIVE',
      }),
    }));
    expect(approved).toMatchObject({ id: 'simple_1', auditStatus: 'APPROVED', status: 'ACTIVE' });
  });

  it('remove clears cart references before deleting an unused inactive product', async () => {
    const tx = {
      cartItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      productTraceLink: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      product: {
        delete: jest.fn().mockResolvedValue({ id: 'product_1' }),
      },
    };
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product_1',
          status: 'INACTIVE',
          skus: [{ id: 'sku_1' }],
        }),
      },
      orderItem: { count: jest.fn().mockResolvedValue(0) },
      cartItem: { count: jest.fn().mockResolvedValue(3) },
      lotteryPrize: { findMany: jest.fn().mockResolvedValue([]) },
      vipGiftItem: { findMany: jest.fn().mockResolvedValue([]) },
      productBundleItem: { findMany: jest.fn().mockResolvedValue([]) },
      checkoutSession: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const service = new AdminProductsService(
      prisma as any,
      new ProductBundleService(),
      passthroughProfitSafety(prisma) as any,
    );

    await expect(service.remove('product_1')).resolves.toEqual({
      ok: true,
      removedCartItems: 3,
    });

    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { skuId: { in: ['sku_1'] } } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('remove rejects products referenced by order items, active checkouts, or bundle products', async () => {
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product_1',
          status: 'INACTIVE',
          skus: [{ id: 'sku_1' }],
        }),
      },
      orderItem: { count: jest.fn().mockResolvedValue(2) },
      cartItem: { count: jest.fn().mockResolvedValue(0) },
      lotteryPrize: { findMany: jest.fn().mockResolvedValue([]) },
      vipGiftItem: { findMany: jest.fn().mockResolvedValue([]) },
      productBundleItem: {
        findMany: jest.fn().mockResolvedValue([{ bundleProduct: { title: '产品包' } }]),
      },
      checkoutSession: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'checkout_1', itemsSnapshot: [{ skuId: 'sku_1' }] },
        ]),
      },
      $transaction: jest.fn(),
    };
    const service = new AdminProductsService(
      prisma as any,
      new ProductBundleService(),
      passthroughProfitSafety(prisma) as any,
    );

    await expect(service.remove('product_1')).rejects.toMatchObject({
      response: {
        message: expect.stringContaining('已有 2 条订单商品明细'),
      },
    });
    await expect(service.remove('product_1')).rejects.toMatchObject({
      response: {
        message: expect.stringContaining('正在被用户结算中'),
      },
    });
    await expect(service.remove('product_1')).rejects.toMatchObject({
      response: {
        message: expect.stringContaining('组合商品：产品包'),
      },
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
