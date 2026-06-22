import { NotFoundException } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductBundleService } from './product-bundle.service';

const buildBundleProduct = () => ({
  id: 'bundle-product-1',
  type: 'BUNDLE',
  title: '水果礼盒',
  subtitle: '组合装',
  description: '精选水果组合',
  detailRich: { sections: [] },
  basePrice: 66,
  unit: '箱',
  origin: { text: '山东' },
  attributes: { gift: true },
  aiKeywords: ['水果', '礼盒'],
  categoryId: 'cat-fruit',
  category: { id: 'cat-fruit', name: '水果' },
  companyId: 'company-1',
  company: { id: 'company-1', name: '果园旗舰店', isPlatform: false },
  returnPolicy: 'RETURNABLE',
  status: 'ACTIVE',
  auditStatus: 'APPROVED',
  media: [
    { id: 'media-1', type: 'IMAGE', url: 'https://cdn.example.com/bundle-cover.jpg', alt: 'bundle cover' },
    { id: 'media-2', type: 'VIDEO', url: 'https://cdn.example.com/bundle.mp4' },
  ],
  tags: [{ tag: { name: '礼盒' } }],
  skus: [
    {
      id: 'bundle-selling-sku',
      title: '标准礼盒',
      price: 66,
      stock: 0,
      skuCode: 'BUNDLE-STD',
      maxPerOrder: 2,
      weightGram: 1,
      status: 'ACTIVE',
    },
  ],
  bundleItems: [
    {
      skuId: 'component-sku-apple',
      quantity: 2,
      sortOrder: 0,
      sku: {
        id: 'component-sku-apple',
        title: '苹果 5斤',
        price: 12.5,
        stock: 9,
        weightGram: 500,
        product: {
          id: 'product-apple',
          title: '烟台苹果',
          media: [{ url: 'https://cdn.example.com/apple.jpg' }],
        },
      },
    },
    {
      skuId: 'component-sku-orange',
      quantity: 1,
      sortOrder: 1,
      sku: {
        id: 'component-sku-orange',
        title: '橙子礼盒',
        price: 8,
        stock: 4,
        weightGram: 300,
        product: {
          id: 'product-orange',
          title: '赣南橙',
          media: [{ url: 'https://cdn.example.com/orange.jpg' }],
        },
      },
    },
  ],
  createdAt: new Date('2026-06-20T00:00:00.000Z'),
});

const buildSimpleProduct = () => ({
  id: 'simple-product-1',
  type: 'SIMPLE',
  title: '苹果',
  subtitle: '当季鲜果',
  description: '甜脆',
  detailRich: null,
  basePrice: 12.5,
  unit: '斤',
  origin: { text: '山东' },
  attributes: {},
  aiKeywords: ['苹果'],
  categoryId: 'cat-fruit',
  category: { id: 'cat-fruit', name: '水果' },
  companyId: 'company-1',
  company: { id: 'company-1', name: '果园旗舰店', isPlatform: false },
  returnPolicy: 'RETURNABLE',
  status: 'ACTIVE',
  auditStatus: 'APPROVED',
  media: [{ id: 'media-simple', type: 'IMAGE', url: 'https://cdn.example.com/simple.jpg', alt: 'simple' }],
  tags: [{ tag: { name: '鲜果' } }],
  skus: [
    {
      id: 'simple-sku-a',
      title: '5斤装',
      price: 12.5,
      stock: 3,
      skuCode: 'APPLE-5',
      maxPerOrder: 5,
      weightGram: 500,
      status: 'ACTIVE',
    },
    {
      id: 'simple-sku-b',
      title: '10斤装',
      price: 22,
      stock: 7,
      skuCode: 'APPLE-10',
      maxPerOrder: 4,
      weightGram: 1000,
      status: 'ACTIVE',
    },
  ],
  bundleItems: [],
  createdAt: new Date('2026-06-19T00:00:00.000Z'),
});

const createPrismaMock = () => ({
  product: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  category: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
});

describe('ProductService bundle mapping', () => {
  it('returns BUNDLE list item type and derives stock from components', async () => {
    const prisma = createPrismaMock();
    prisma.product.findMany.mockResolvedValue([buildBundleProduct()]);
    prisma.product.count.mockResolvedValue(1);
    const service = new ProductService(prisma as any, new ProductBundleService());

    const result = await service.list();

    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        bundleItems: expect.any(Object),
      }),
    }));
    expect(result.items[0]).toMatchObject({
      id: 'bundle-product-1',
      type: 'BUNDLE',
      defaultSkuId: 'bundle-selling-sku',
      stock: 4,
    });
  });

  it('preserves SIMPLE list stock behavior', async () => {
    const prisma = createPrismaMock();
    prisma.product.findMany.mockResolvedValue([buildSimpleProduct()]);
    prisma.product.count.mockResolvedValue(1);
    const service = new ProductService(prisma as any, new ProductBundleService());

    const result = await service.list();

    expect(result.items[0]).toMatchObject({
      id: 'simple-product-1',
      type: 'SIMPLE',
      stock: 10,
      defaultSkuId: 'simple-sku-a',
    });
  });

  it('returns bundleItems separately and keeps selling SKU selectable on detail', async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue(buildBundleProduct());
    const service = new ProductService(prisma as any, new ProductBundleService());

    const result = await service.getById('bundle-product-1');

    expect(prisma.product.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        bundleItems: expect.any(Object),
      }),
    }));
    expect(result).toMatchObject({
      id: 'bundle-product-1',
      type: 'BUNDLE',
      bundleAvailableStock: 4,
      bundleTotalWeightGram: 1300,
      skus: [
        expect.objectContaining({
          id: 'bundle-selling-sku',
          title: '标准礼盒',
          price: 66,
          stock: 0,
        }),
      ],
    });
    expect(result.bundleItems).toEqual([
      {
        skuId: 'component-sku-apple',
        productId: 'product-apple',
        productTitle: '烟台苹果',
        skuTitle: '苹果 5斤',
        quantity: 2,
        image: 'https://cdn.example.com/apple.jpg',
        stock: 9,
        weightGram: 500,
      },
      {
        skuId: 'component-sku-orange',
        productId: 'product-orange',
        productTitle: '赣南橙',
        skuTitle: '橙子礼盒',
        quantity: 1,
        image: 'https://cdn.example.com/orange.jpg',
        stock: 4,
        weightGram: 300,
      },
    ]);
    expect(result).not.toHaveProperty('bundleReferenceTotal');
    expect(result.bundleItems[0]).not.toHaveProperty('price');
    expect(result.bundleItems[1]).not.toHaveProperty('price');
  });

  it('still hides platform products from buyer detail', async () => {
    const prisma = createPrismaMock();
    prisma.product.findUnique.mockResolvedValue({
      ...buildBundleProduct(),
      company: { id: 'company-platform', name: '爱买买app', isPlatform: true },
    });
    const service = new ProductService(prisma as any, new ProductBundleService());

    await expect(service.getById('bundle-product-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
