import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
          skus: [],
          media: [],
          tags: [],
        }),
      },
      productSKU: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'sku_1' }),
      },
      productMedia: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      productTag: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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
          skus: [],
          media: [],
          tags: [],
        }),
      },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const bonusConfig = { getSystemConfig: jest.fn().mockResolvedValue({ markupRate: 1.3 }) };
    const semanticFillService = { fillProduct: jest.fn() };
    const service = new SellerProductsService(
      prisma as any,
      bonusConfig as any,
      semanticFillService as any,
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
});
