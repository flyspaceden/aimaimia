import { BadRequestException, ConflictException } from '@nestjs/common';
import { CompanyStatus } from '@prisma/client';
import { AdminCompaniesService } from './admin-companies.service';

function createPrismaMock() {
  const prisma: any = {
    company: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'company-1',
        name: '测试企业',
        status: CompanyStatus.ACTIVE,
        isPlatform: false,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orderItem: { count: jest.fn().mockResolvedValue(0) },
    afterSaleRequest: { count: jest.fn().mockResolvedValue(0) },
    refund: { count: jest.fn().mockResolvedValue(0) },
    shipment: { count: jest.fn().mockResolvedValue(0) },
    groupBuyActivity: { count: jest.fn().mockResolvedValue(0) },
    groupBuyInstance: { count: jest.fn().mockResolvedValue(0) },
    booking: { count: jest.fn().mockResolvedValue(0) },
    group: { count: jest.fn().mockResolvedValue(0) },
    companyActivity: { count: jest.fn().mockResolvedValue(0) },
    rewardLedger: { count: jest.fn().mockResolvedValue(0) },
    checkoutSession: { findMany: jest.fn().mockResolvedValue([]) },
    sellerSession: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  prisma.$transaction = jest.fn((callback: (tx: any) => unknown) => callback(prisma));
  return prisma;
}

describe('AdminCompaniesService company lifecycle', () => {
  it('allows deletion only when the company has no unfinished business', async () => {
    const prisma = createPrismaMock();
    const service = new AdminCompaniesService(prisma, { invalidateListCache: jest.fn() } as any);

    await expect(service.getDeletionCheck('company-1')).resolves.toEqual({
      canDelete: true,
      company: {
        id: 'company-1',
        name: '测试企业',
        status: CompanyStatus.ACTIVE,
        isPlatform: false,
      },
      blockers: [],
    });
    expect(prisma.checkoutSession.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: expect.any(Date) },
      },
      select: { itemsSnapshot: true },
    });
  });

  it('blocks platform companies and companies with unfinished orders', async () => {
    const platformPrisma = createPrismaMock();
    platformPrisma.company.findUnique.mockResolvedValue({
      id: 'PLATFORM_COMPANY',
      name: '爱买买app',
      status: CompanyStatus.ACTIVE,
      isPlatform: true,
    });
    const platformService = new AdminCompaniesService(platformPrisma, {} as any);
    const platformCheck = await platformService.getDeletionCheck('PLATFORM_COMPANY');
    expect(platformCheck.canDelete).toBe(false);
    expect(platformCheck.blockers).toEqual([
      expect.objectContaining({ code: 'PLATFORM_COMPANY' }),
    ]);

    const orderPrisma = createPrismaMock();
    orderPrisma.orderItem.count.mockResolvedValue(2);
    const orderService = new AdminCompaniesService(orderPrisma, {} as any);
    const orderCheck = await orderService.getDeletionCheck('company-1');
    expect(orderCheck.canDelete).toBe(false);
    expect(orderCheck.blockers).toContainEqual({
      code: 'OPEN_ORDERS',
      label: '待履约订单商品',
      count: 2,
    });
  });

  it('requires the exact company name and soft deletes with seller sessions revoked', async () => {
    const prisma = createPrismaMock();
    const companyService = { invalidateListCache: jest.fn() };
    const service = new AdminCompaniesService(prisma, companyService as any);

    await expect(service.remove('company-1', '错误名称')).rejects.toBeInstanceOf(BadRequestException);

    const result = await service.remove('company-1', '测试企业');
    expect(result).toEqual(expect.objectContaining({ ok: true, companyId: 'company-1' }));
    expect(prisma.company.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'company-1', isPlatform: false }),
      data: expect.objectContaining({
        status: CompanyStatus.DELETED,
        deletedFromStatus: CompanyStatus.ACTIVE,
      }),
    }));
    expect(prisma.company.updateMany.mock.calls.at(-1)?.[0]?.data).not.toHaveProperty('suspendedUntil');
    expect(prisma.sellerSession.deleteMany).toHaveBeenCalledWith({
      where: { staff: { companyId: 'company-1' } },
    });
    expect(companyService.invalidateListCache).toHaveBeenCalled();
  });

  it('re-checks blockers inside the delete transaction', async () => {
    const prisma = createPrismaMock();
    prisma.orderItem.count.mockResolvedValue(1);
    const service = new AdminCompaniesService(prisma, {} as any);

    await expect(service.remove('company-1', '测试企业')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.company.updateMany).not.toHaveBeenCalled();
  });

  it('restores the company to its pre-delete status with CAS', async () => {
    const prisma = createPrismaMock();
    prisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      status: CompanyStatus.DELETED,
      isPlatform: false,
      deletedAt: new Date('2026-08-21T02:00:00.000Z'),
      deletedFromStatus: CompanyStatus.SUSPENDED,
    });
    const companyService = { invalidateListCache: jest.fn() };
    const service = new AdminCompaniesService(prisma, companyService as any);

    await expect(service.restore('company-1')).resolves.toEqual({
      ok: true,
      companyId: 'company-1',
      status: CompanyStatus.SUSPENDED,
    });
    expect(prisma.company.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        status: CompanyStatus.SUSPENDED,
        deletedAt: null,
        deletedFromStatus: null,
      },
    }));
  });

  it('keeps deleted companies read-only until they are restored', async () => {
    const prisma = createPrismaMock();
    prisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: '测试企业',
      status: CompanyStatus.DELETED,
      isPlatform: false,
    });
    const service = new AdminCompaniesService(prisma, {} as any);

    await expect(service.updateCompanyTags('company-1', []))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
