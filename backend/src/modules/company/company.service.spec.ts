import { CompanyService } from './company.service';

describe('CompanyService', () => {
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
