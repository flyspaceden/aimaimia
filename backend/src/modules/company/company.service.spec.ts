import { CompanyService } from './company.service';

describe('CompanyService', () => {
  describe('listCompanyProducts bundle stock', () => {
    it('derives bundle card stock from component SKUs instead of the selling SKU placeholder', async () => {
      const prisma = {
        product: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              {
                id: 'bundle-product',
                type: 'BUNDLE',
                title: '399龙虾7件套装',
                basePrice: 399.1,
                media: [{ url: 'https://example.com/lobster.webp' }],
                skus: [{ id: 'bundle-selling-sku', price: 399.1, stock: 0, maxPerOrder: null }],
                bundleItems: [
                  { quantity: 2, sku: { stock: 18 } },
                  { quantity: 1, sku: { stock: 29 } },
                ],
                tags: [],
                unit: '斤',
                origin: { text: '印度洋/阳江海陵岛' },
                originRegion: null,
                category: { name: '水产' },
              },
            ])
            .mockResolvedValueOnce([{ category: { name: '水产' } }]),
          count: jest.fn().mockResolvedValue(1),
        },
      };
      const service = new CompanyService(prisma as any);

      const result = await service.listCompanyProducts('company-1', { page: 1, pageSize: 10 });

      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          include: expect.objectContaining({
            bundleItems: expect.any(Object),
          }),
        }),
      );
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'bundle-product',
          stock: 9,
          defaultSkuId: 'bundle-selling-sku',
        }),
      );
    });
  });

  describe('getById inspectionReports', () => {
    it('returns only verified inspection documents for the public company detail', async () => {
      const issuedAt = new Date('2026-06-01T00:00:00.000Z');
      const createdAt = new Date('2026-06-02T03:04:05.000Z');
      const prisma = {
        company: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'c-1',
            name: '测试企业',
            shortName: null,
            cover: null,
            description: '主营农产品',
            address: { text: '广东深圳' },
            profile: { highlights: { companyType: 'company' } },
            companyTags: [],
            documents: [
              {
                id: 'doc-inspection-verified',
                type: 'INSPECTION',
                title: '农残检测报告',
                fileUrl: 'https://example.com/reports/inspection.pdf',
                issuer: '第三方检测中心',
                issuedAt,
                createdAt,
                verifyStatus: 'VERIFIED',
              },
              {
                id: 'doc-inspection-pending',
                type: 'INSPECTION',
                title: '待审核检测报告',
                fileUrl: 'https://example.com/reports/pending.pdf',
                issuer: '第三方检测中心',
                issuedAt: null,
                createdAt,
                verifyStatus: 'PENDING',
              },
              {
                id: 'doc-license-verified',
                type: 'LICENSE',
                title: '营业执照',
                fileUrl: 'https://example.com/reports/license.pdf',
                issuer: '市场监督管理局',
                issuedAt: null,
                createdAt,
                verifyStatus: 'VERIFIED',
              },
            ],
          }),
        },
        follow: { findUnique: jest.fn() },
      };
      const service = new CompanyService(prisma as any);

      const result = await service.getById('c-1');

      expect(prisma.company.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c-1' },
          include: expect.objectContaining({
            documents: expect.objectContaining({
              where: { type: 'INSPECTION', verifyStatus: 'VERIFIED' },
            }),
          }),
        }),
      );
      expect((result as any).inspectionReports).toEqual([
        {
          id: 'doc-inspection-verified',
          title: '农残检测报告',
          fileUrl: 'https://example.com/reports/inspection.pdf',
          issuer: '第三方检测中心',
          issuedAt: issuedAt.toISOString(),
          createdAt: createdAt.toISOString(),
        },
      ]);
    });
  });
});
