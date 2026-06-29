import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryAdminOpsService } from './delivery-admin-ops.service';

describe('DeliveryAdminOpsService', () => {
  let deliveryPrisma: any;
  let service: DeliveryAdminOpsService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryMerchant: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      deliveryMerchantApplication: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      deliveryPayment: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      deliveryCategory: {
        count: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      deliveryProduct: {
        count: jest.fn(),
      },
      deliveryAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit_1' }),
      },
      $transaction: jest.fn(async (input: any) => {
        if (typeof input === 'function') {
          return input(deliveryPrisma);
        }
        return Promise.all(input);
      }),
    };

    service = new DeliveryAdminOpsService(deliveryPrisma as DeliveryPrismaService);
  });

  it('removes password hashes from merchant staff details', async () => {
    deliveryPrisma.deliveryMerchant.findUnique.mockResolvedValue({
      id: 'merchant_1',
      name: '配送中心A',
      staff: [
        {
          id: 'staff_1',
          username: 'ops_1',
          role: 'OPERATOR',
          passwordHash: 'secret-hash',
        },
      ],
    });

    const merchant = await service.getMerchant('merchant_1');

    expect(merchant).toEqual({
      id: 'merchant_1',
      name: '配送中心A',
      staff: [
        {
          id: 'staff_1',
          username: 'ops_1',
          role: 'OPERATOR',
        },
      ],
    });
    expect(merchant.staff[0]).not.toHaveProperty('passwordHash');
  });

  it('removes password hashes from reviewedByAdmin application details', async () => {
    deliveryPrisma.deliveryMerchantApplication.findUnique.mockResolvedValue({
      id: 'application_1',
      status: 'APPROVED',
      reviewedByAdmin: {
        id: 'admin_1',
        username: 'delivery-admin',
        passwordHash: 'admin-secret',
      },
      merchant: {
        id: 'merchant_1',
        name: '配送中心A',
      },
    });

    const application = await service.getMerchantApplication('application_1');

    expect(application).toEqual({
      id: 'application_1',
      status: 'APPROVED',
      reviewedByAdmin: {
        id: 'admin_1',
        username: 'delivery-admin',
      },
      merchant: {
        id: 'merchant_1',
        name: '配送中心A',
      },
    });
    expect(application.reviewedByAdmin).not.toHaveProperty('passwordHash');
  });

  it('lists provider-failed payments and paid abnormal payments that need manual handling', async () => {
    deliveryPrisma.deliveryPayment.count.mockResolvedValue(1);
    deliveryPrisma.deliveryPayment.findMany.mockResolvedValue([
      {
        id: 'PSZF0000000000001',
        status: 'PAID',
        exceptionSummary: '配送订单创建失败',
      },
    ]);

    const result = await service.listAbnormalPayments({ page: 1, pageSize: 20 });

    expect(deliveryPrisma.deliveryPayment.count).toHaveBeenCalledWith({
      where: {
        OR: [{ status: 'FAILED' }, { exceptionSummary: { not: null } }],
      },
    });
    expect(deliveryPrisma.deliveryPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ status: 'FAILED' }, { exceptionSummary: { not: null } }],
        },
      }),
    );
    expect(result.items).toHaveLength(1);
  });

  it('writes audit logs when an admin updates a delivery merchant', async () => {
    const before = {
      id: 'merchant_1',
      name: '配送中心A',
      status: 'ACTIVE',
      servicePhone: '400-100',
      defaultMarkupBps: 1200,
    };
    const after = {
      ...before,
      name: '配送中心A新名称',
      defaultMarkupBps: 1500,
    };
    deliveryPrisma.deliveryMerchant.findUnique.mockResolvedValue(before);
    deliveryPrisma.deliveryMerchant.update.mockResolvedValue(after);

    await service.updateMerchant('merchant_1', {
      name: '配送中心A新名称',
      defaultMarkupBps: 1500,
    }, 'admin_1');

    expect(deliveryPrisma.deliveryAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'ADMIN',
        actorId: 'admin_1',
        module: 'merchants',
        action: 'UPDATE_MERCHANT',
        targetType: 'DeliveryMerchant',
        targetId: 'merchant_1',
        before,
        after,
      }),
    });
  });

  it('writes audit logs when an admin reviews a delivery merchant application', async () => {
    const before = {
      id: 'application_1',
      status: 'PENDING',
      merchantId: null,
      rejectReason: null,
    };
    const after = {
      ...before,
      status: 'APPROVED',
      merchantId: 'merchant_1',
      reviewedByAdminId: 'admin_1',
    };
    deliveryPrisma.deliveryMerchantApplication.findUnique.mockResolvedValue(before);
    deliveryPrisma.deliveryMerchantApplication.update.mockResolvedValue(after);

    await service.reviewMerchantApplication('admin_1', 'application_1', {
      status: 'APPROVED',
      merchantId: 'merchant_1',
    });

    expect(deliveryPrisma.deliveryAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'ADMIN',
        actorId: 'admin_1',
        module: 'merchants',
        action: 'REVIEW_MERCHANT_APPLICATION',
        targetType: 'DeliveryMerchantApplication',
        targetId: 'application_1',
        before,
        after,
      }),
    });
  });

  it('creates child delivery categories with a delivery-local path and audit log', async () => {
    deliveryPrisma.deliveryCategory.findUnique.mockResolvedValue({
      id: 'cat_parent',
      name: '生鲜食材',
      path: 'fresh',
      level: 1,
    });
    deliveryPrisma.deliveryCategory.create.mockResolvedValue({
      id: 'cat_child',
      name: '蔬菜',
      parentId: 'cat_parent',
      path: 'fresh/蔬菜',
      level: 2,
      sortOrder: 30,
      status: 'ACTIVE',
    });

    const result = await (service as any).createCategory({
      name: ' 蔬菜 ',
      parentId: 'cat_parent',
      sortOrder: 30,
    }, 'admin_1');

    expect(deliveryPrisma.deliveryCategory.create).toHaveBeenCalledWith({
      data: {
        name: '蔬菜',
        parentId: 'cat_parent',
        path: 'fresh/蔬菜',
        level: 2,
        sortOrder: 30,
        status: 'ACTIVE',
      },
    });
    expect(deliveryPrisma.deliveryAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'ADMIN',
        actorId: 'admin_1',
        module: 'categories',
        action: 'CREATE_CATEGORY',
        targetType: 'DeliveryCategory',
        targetId: 'cat_child',
        after: result,
      }),
    });
  });

  it('renames delivery categories and updates descendant paths in one serializable transaction', async () => {
    deliveryPrisma.deliveryCategory.findUnique.mockResolvedValue({
      id: 'cat_parent',
      name: '生鲜食材',
      path: 'fresh',
      level: 1,
      parentId: null,
    });
    deliveryPrisma.deliveryCategory.findMany.mockResolvedValue([
      { id: 'cat_child', path: 'fresh/fruits' },
    ]);
    deliveryPrisma.deliveryCategory.update.mockResolvedValue({
      id: 'cat_parent',
      name: '新鲜食材',
      path: '新鲜食材',
      level: 1,
      parentId: null,
      status: 'ACTIVE',
    });

    await (service as any).updateCategory('cat_parent', { name: ' 新鲜食材 ' }, 'admin_1');

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: expect.any(String) },
    );
    expect(deliveryPrisma.deliveryCategory.findMany).toHaveBeenCalledWith({
      where: { path: { startsWith: 'fresh/' } },
    });
    expect(deliveryPrisma.deliveryCategory.update).toHaveBeenCalledWith({
      where: { id: 'cat_parent' },
      data: { name: '新鲜食材', path: '新鲜食材' },
    });
    expect(deliveryPrisma.deliveryCategory.update).toHaveBeenCalledWith({
      where: { id: 'cat_child' },
      data: { path: '新鲜食材/fruits' },
    });
  });

  it('skips no-op delivery category updates after normalizing the name', async () => {
    const before = {
      id: 'cat_1',
      name: '生鲜食材',
      path: '生鲜食材',
      level: 1,
      parentId: null,
      sortOrder: 0,
      status: 'ACTIVE',
    };
    deliveryPrisma.deliveryCategory.findUnique.mockResolvedValue(before);

    const result = await (service as any).updateCategory('cat_1', { name: ' 生鲜食材 ' }, 'admin_1');

    expect(result).toEqual(before);
    expect(deliveryPrisma.deliveryCategory.update).not.toHaveBeenCalled();
    expect(deliveryPrisma.deliveryAuditLog.create).not.toHaveBeenCalled();
  });

  it('blocks deleting delivery categories that still contain products', async () => {
    deliveryPrisma.deliveryCategory.findUnique.mockResolvedValue({
      id: 'cat_1',
      _count: { children: 0, products: 2 },
    });

    await expect((service as any).removeCategory('cat_1', 'admin_1')).rejects.toThrow('该分类下有商品，无法删除');
    expect(deliveryPrisma.deliveryCategory.delete).not.toHaveBeenCalled();
  });
});
