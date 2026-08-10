import { RecommendationService } from './recommendation.service';
import { ProductBundleService } from '../product/product-bundle.service';

const createService = (prisma: unknown) => (
  new RecommendationService(prisma as any, new ProductBundleService())
);

describe('RecommendationService buyer visibility', () => {
  it('only recommends approved products from active non-platform companies', async () => {
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = createService(prisma);

    await service.getForUser('buyer-1');

    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        company: { status: 'ACTIVE', isPlatform: false },
      },
    }));
  });

  it('returns the company, product type and cheapest active SKU needed by both client cards', async () => {
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue([{
        id: 'product-1', type: 'SIMPLE', title: '蓝莓', basePrice: 39, unit: '盒',
        origin: { text: '丹东' }, aiKeywords: [], categoryId: 'category-1', companyId: 'company-1',
        company: { name: '产地企业' }, media: [{ url: 'https://example.com/blueberry.jpg' }], tags: [],
        skus: [
          { id: 'sku-high', price: 39, stock: 3, maxPerOrder: 5 },
          { id: 'sku-low', price: 29, stock: 4, maxPerOrder: 3 },
        ],
      }]) },
    };
    const service = createService(prisma);

    await expect(service.getForUser('buyer-1')).resolves.toMatchObject([{
      product: {
        type: 'SIMPLE', price: 29, defaultSkuId: 'sku-low', priceFrom: true,
        unit: '盒', companyName: '产地企业', stock: 7, maxPerOrder: 3,
      },
    }]);
  });

  it('uses component availability instead of selling-SKU stock for bundles', async () => {
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue([{
        id: 'bundle-1', type: 'BUNDLE', title: '海鲜礼包', basePrice: 399, unit: '套',
        origin: null, aiKeywords: [], categoryId: 'category-1', companyId: 'company-1',
        company: { name: '产地企业' }, media: [], tags: [],
        skus: [{ id: 'bundle-sku', price: 399, stock: 99, maxPerOrder: null }],
        bundleItems: [
          {
            quantity: 2,
            sku: {
              stock: 5,
              status: 'ACTIVE',
              product: { status: 'ACTIVE', auditStatus: 'APPROVED' },
            },
          },
          {
            quantity: 1,
            sku: {
              stock: 8,
              status: 'ACTIVE',
              product: { status: 'ACTIVE', auditStatus: 'APPROVED' },
            },
          },
        ],
      }]) },
    };
    const service = createService(prisma);

    await expect(service.getForUser('buyer-1')).resolves.toMatchObject([{
      product: { stock: 99, bundleAvailableStock: 2 },
    }]);
  });
});
