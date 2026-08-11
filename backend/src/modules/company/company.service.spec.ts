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
      const service = new CompanyService(prisma as any, {} as any, {} as any);

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
          type: 'BUNDLE',
          stock: 9,
          bundleAvailableStock: 9,
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
          findFirst: jest.fn().mockResolvedValue({
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
                expiresAt: null,
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
      const uploadService = {
        canPreviewCompanyDocument: jest.fn().mockReturnValue(true),
      };
      const config = {
        get: jest.fn((key: string) => key === 'PUBLIC_API_BASE_URL' ? 'https://api.example.com/api/v1' : undefined),
      };
      const service = new CompanyService(prisma as any, uploadService as any, config as any);

      const result = await service.getById('c-1');

      expect(prisma.company.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c-1', status: 'ACTIVE', isPlatform: false },
          include: expect.objectContaining({
            documents: expect.objectContaining({
              where: expect.objectContaining({
                type: 'INSPECTION',
                verifyStatus: 'VERIFIED',
                OR: expect.any(Array),
              }),
            }),
          }),
        }),
      );
      expect((result as any).inspectionReports).toEqual([
        {
          id: 'doc-inspection-verified',
          title: '农残检测报告',
          previewAvailable: true,
          fileUrl: 'https://api.example.com/api/v1/companies/inspection-reports/doc-inspection-verified/preview',
          issuer: '第三方检测中心',
          issuedAt: issuedAt.toISOString(),
          createdAt: createdAt.toISOString(),
        },
      ]);
      expect(uploadService.canPreviewCompanyDocument).toHaveBeenCalledWith(
        'https://example.com/reports/inspection.pdf',
      );
      expect((result as any).inspectionReports[0].fileUrl).not.toBe('https://example.com/reports/inspection.pdf');
    });

    it('looks up only an active, unexpired verified report before reading its controlled storage object', async () => {
      const previewFile = {
        filePath: '/tmp/documents/report.pdf',
        mimeType: 'application/pdf',
        basename: 'report.pdf',
      };
      const prisma = {
        companyDocument: {
          findFirst: jest.fn().mockResolvedValue({
            title: '农残检测报告.pdf',
            fileUrl: 'http://localhost:3000/uploads/documents/report.pdf',
          }),
        },
      };
      const uploadService = {
        getCompanyDocumentPreviewFile: jest.fn().mockResolvedValue(previewFile),
      };
      const service = new CompanyService(prisma as any, uploadService as any, {} as any);

      await expect(service.getInspectionReportPreview('doc-verified')).resolves.toEqual({
        ...previewFile,
        title: '农残检测报告.pdf',
      });
      expect(prisma.companyDocument.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'doc-verified',
          type: 'INSPECTION',
          verifyStatus: 'VERIFIED',
          company: { status: 'ACTIVE', isPlatform: false },
          OR: expect.any(Array),
        }),
        select: { fileUrl: true, title: true },
      });
      expect(uploadService.getCompanyDocumentPreviewFile).toHaveBeenCalledWith(
        'http://localhost:3000/uploads/documents/report.pdf',
      );
    });
  });

  it('only lists active non-platform companies and applies a server-side keyword', async () => {
    const prisma = {
      company: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CompanyService(prisma as any, {} as any, {} as any);

    await service.list(undefined, '苹果');

    expect(prisma.company.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'ACTIVE',
        isPlatform: false,
        OR: [
          { name: { contains: '苹果', mode: 'insensitive' } },
          { shortName: { contains: '苹果', mode: 'insensitive' } },
          { description: { contains: '苹果', mode: 'insensitive' } },
        ],
      },
    }));
  });

  it('only returns an activity owned by an active non-platform company', async () => {
    const activity = {
      id: 'event-1',
      companyId: 'company-1',
      title: '采摘活动',
      startAt: new Date('2026-08-03T01:00:00.000Z'),
      endAt: null,
      content: {},
    };
    const prisma = {
      companyActivity: { findFirst: jest.fn().mockResolvedValue(activity) },
    };
    const service = new CompanyService(prisma as any, {} as any, {} as any);

    await expect(service.getActivityById('event-1')).resolves.toMatchObject({ id: 'event-1' });
    expect(prisma.companyActivity.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'event-1',
        company: { status: 'ACTIVE', isPlatform: false },
      },
    });
  });
});
