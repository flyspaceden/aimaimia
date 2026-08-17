import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decryptJsonValue, decryptText, encryptJsonValue, encryptText } from '../../common/security/encryption';
import { PickupService } from './pickup.service';

describe('PickupService', () => {
  const originalFlag = process.env.PICKUP_FULFILLMENT_ENABLED;

  beforeEach(() => {
    process.env.PICKUP_FULFILLMENT_ENABLED = 'true';
  });

  afterAll(() => {
    process.env.PICKUP_FULFILLMENT_ENABLED = originalFlag;
  });

  function createService(prisma: any, orderService: any = { handlePickupReceived: jest.fn() }) {
    const notificationService = { emit: jest.fn().mockResolvedValue({ id: 'outbox-1' }) };
    const moduleRef = { get: jest.fn().mockReturnValue(orderService) };
    const service = new PickupService(prisma, moduleRef as any, notificationService as any);
    (service as any).orderService = orderService;
    return { service, notificationService, orderService };
  }

  it('严格校验每个商家的启用自提点归属', async () => {
    const tx = {
      company: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]) },
      pickupPoint: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1', companyId: 'c1', isActive: true, name: '一号店',
            contactName: '张三', contactPhone: '13812345678', regionCode: '110000',
            regionText: '北京市', detail: '朝阳区 1 号', businessHours: { summary: '9:00-18:00' },
            company: { id: 'c1', name: '商家一', status: 'ACTIVE' },
          },
          {
            id: 'p2', companyId: 'c2', isActive: true, name: '二号店',
            contactName: '李四', contactPhone: '13912345678', regionCode: '310000',
            regionText: '上海市', detail: '浦东新区 2 号', businessHours: { summary: '10:00-19:00' },
            company: { id: 'c2', name: '商家二', status: 'ACTIVE' },
          },
        ]),
      },
    };
    const { service } = createService({});

    const result = await service.validateCheckoutFulfillment(tx as any, ['c1', 'c2'], {
      mode: 'PICKUP',
      recipientName: '王五',
      recipientPhone: '13712345678',
      selections: [
        { companyId: 'c1', pickupPointId: 'p1' },
        { companyId: 'c2', pickupPointId: 'p2' },
        { companyId: 'stale-company', pickupPointId: 'stale-point' },
      ],
    });

    expect(result.mode).toBe('PICKUP');
    if (result.mode === 'PICKUP') {
      expect(decryptJsonValue<any>(result.recipientSnapshot)).toEqual({
        recipientName: '王五',
        phone: '13712345678',
      });
      expect(result.selectionsSnapshot.map((item) => item.companyId)).toEqual(['c1', 'c2']);
    }
    expect(tx.pickupPoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['p1', 'p2'] }, isActive: true, deletedAt: null },
    }));

    tx.pickupPoint.findMany.mockResolvedValueOnce([
      { ...((await tx.pickupPoint.findMany())[0]), companyId: 'other' },
    ]);
    await expect(service.validateCheckoutFulfillment(tx as any, ['c1'], {
      mode: 'PICKUP',
      recipientName: '王五',
      recipientPhone: '13712345678',
      selections: [{ companyId: 'c1', pickupPointId: 'p1' }],
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKUP_POINT_MISMATCH' }),
    });
  });

  it('结算时自提点不存在或已停用返回结构化刷新码', async () => {
    const tx = {
      company: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
      pickupPoint: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const { service } = createService({});

    await expect(service.validateCheckoutFulfillment(tx as any, ['c1'], {
      mode: 'PICKUP',
      recipientName: '王五',
      recipientPhone: '13712345678',
      selections: [{ companyId: 'c1', pickupPointId: 'missing' }],
    })).rejects.toMatchObject({
      response: {
        code: 'PICKUP_POINT_UNAVAILABLE',
        message: '所选自提点不存在或已停用',
      },
    });
  });

  it('允许多个企业选择同一平台中心仓，但每个企业仍保留独立 selection 快照', async () => {
    const hub = {
      id: 'hub-1', companyId: 'platform-1', kind: 'PLATFORM_HUB', coverage: 'ALL_ACTIVE_COMPANIES',
      isActive: true, name: '爱买买中心仓', contactName: '仓管', contactPhone: '13812345678',
      regionCode: '440305', regionText: '广东省深圳市南山区', detail: '中心仓 1 号',
      businessHours: { summary: '09:00-18:00' }, serviceCompanies: [],
      company: { id: 'platform-1', name: '爱买买app', status: 'ACTIVE', isPlatform: true },
    };
    const tx = {
      company: { findMany: jest.fn().mockResolvedValue([{ id: 'merchant-a' }, { id: 'merchant-b' }]) },
      pickupPoint: { findMany: jest.fn().mockResolvedValue([hub]) },
    };
    const { service } = createService({});

    const result = await service.validateCheckoutFulfillment(tx as any, ['merchant-a', 'merchant-b'], {
      mode: 'PICKUP', recipientName: '王五', recipientPhone: '13712345678',
      selections: [
        { companyId: 'merchant-a', pickupPointId: 'hub-1' },
        { companyId: 'merchant-b', pickupPointId: 'hub-1' },
      ],
    });

    expect(result.mode).toBe('PICKUP');
    if (result.mode === 'PICKUP') {
      expect(result.selectionsSnapshot).toHaveLength(2);
      expect(result.selectionsSnapshot.map((selection) => selection.pickupPointId)).toEqual(['hub-1', 'hub-1']);
      expect(result.selectionsSnapshot.map((selection) => selection.companyId)).toEqual(['merchant-a', 'merchant-b']);
    }
  });

  it('买家只能看见本企业自有点和明确服务本企业的平台中心仓', async () => {
    const prisma = {
      company: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', name: '商家一' }, { id: 'c2', name: '商家二' }]) },
      pickupPoint: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'own-c1', companyId: 'c1', kind: 'MERCHANT', name: '商家一门店', contactName: '甲', contactPhone: encryptText('13812345678'), regionText: '深圳', detail: '1号', businessHours: {} },
          { id: 'hub-all', companyId: 'platform', kind: 'PLATFORM_HUB', coverage: 'ALL_ACTIVE_COMPANIES', name: '中心仓', contactName: '乙', contactPhone: encryptText('13912345678'), regionText: '深圳', detail: '2号', businessHours: {}, company: { isPlatform: true }, serviceCompanies: [] },
          { id: 'hub-c2', companyId: 'platform', kind: 'PLATFORM_HUB', coverage: 'SELECTED_COMPANIES', name: '二号专仓', contactName: '丙', contactPhone: encryptText('13712345678'), regionText: '深圳', detail: '3号', businessHours: {}, company: { isPlatform: true }, serviceCompanies: [{ companyId: 'c2' }] },
        ]),
      },
    };
    const { service } = createService(prisma);

    await expect(service.listBuyerPoints(['c1', 'c2'])).resolves.toEqual({
      items: [
        expect.objectContaining({ companyId: 'c1', points: expect.arrayContaining([
          expect.objectContaining({ id: 'own-c1', isPlatformHub: false }),
          expect.objectContaining({ id: 'hub-all', isPlatformHub: true }),
        ]) }),
        expect.objectContaining({ companyId: 'c2', points: expect.arrayContaining([
          expect.objectContaining({ id: 'hub-all', isPlatformHub: true }),
          expect.objectContaining({ id: 'hub-c2', isPlatformHub: true }),
        ]) }),
      ],
    });
  });

  it('支付前锁定后即使点位已停用也能建单，且不保存明文凭证', async () => {
    let createdData: any;
    const tx = {
      pickupFulfillment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => {
          createdData = data;
          return { id: 'pf1', ...data };
        }),
      },
      pickupPoint: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', companyId: 'c1', isActive: false }),
      },
    };
    const { service } = createService({});

    await service.createForPaidOrder(tx as any, {
      orderId: 'o1',
      companyId: 'c1',
      recipientSnapshot: { __enc: 'v1', alg: 'aes-256-gcm', iv: 'x', tag: 'y', data: 'z' },
      selectionsSnapshot: [{
        companyId: 'c1',
        pickupPointId: 'p1',
        pickupPointSnapshot: { id: 'p1', companyId: 'c1', name: '一号店' },
      }],
    });

    expect(createdData.pickupCodeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(createdData.pickupTokenDigest).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(createdData);
    const credentials = decryptJsonValue<any>(createdData.pickupCredentialEncrypted);
    expect(credentials.pickupCode).toMatch(/^\d{8}$/);
    expect(credentials.pickupToken.length).toBeGreaterThan(20);
    expect(serialized).not.toContain(credentials.pickupCode);
    expect(serialized).not.toContain(credentials.pickupToken);
  });

  it('平台管理员可在不冒充企业员工的情况下标记备货完成，并保留真实审计主体', async () => {
    const tx = {
      pickupFulfillment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pf1', status: 'PREPARING', readyAt: null,
          order: { id: 'o1', fulfillmentMode: 'PICKUP', status: 'PAID', items: [{ companyId: 'merchant-1' }] },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pickupFulfillmentEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const { service, notificationService } = createService(prisma);

    await expect(service.markReadyByAdmin('admin-1', 'o1')).resolves.toEqual(expect.objectContaining({
      orderId: 'o1', status: 'READY', alreadyReady: false,
    }));
    expect(tx.pickupFulfillmentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'ADMIN_READY', actorType: 'ADMIN', actorId: 'admin-1' }),
    }));
    expect(notificationService.emit).toHaveBeenCalledWith(expect.objectContaining({
      actor: { kind: 'admin', id: 'admin-1' },
    }), expect.anything());
  });

  it('生产环境缺少凭证 secret 时在建凭证前 fail closed', async () => {
    const previous = {
      nodeEnv: process.env.NODE_ENV,
      pickupSecret: process.env.PICKUP_TOKEN_SECRET,
      encryptionKey: process.env.DATA_ENCRYPTION_KEY,
      jwtSecret: process.env.JWT_SECRET,
    };
    process.env.NODE_ENV = 'production';
    delete process.env.PICKUP_TOKEN_SECRET;
    delete process.env.DATA_ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
    try {
      const tx = {
        pickupFulfillment: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
        pickupPoint: {
          findUnique: jest.fn().mockResolvedValue({ id: 'p1', companyId: 'c1' }),
        },
      };
      const { service } = createService({});

      await expect(service.createForPaidOrder(tx as any, {
        orderId: 'o1',
        companyId: 'c1',
        recipientSnapshot: {},
        selectionsSnapshot: [{
          companyId: 'c1',
          pickupPointId: 'p1',
          pickupPointSnapshot: { id: 'p1', companyId: 'c1' },
        }],
      })).rejects.toMatchObject({ status: 503 });
      expect(tx.pickupFulfillment.create).not.toHaveBeenCalled();
    } finally {
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.nodeEnv;
      if (previous.pickupSecret === undefined) delete process.env.PICKUP_TOKEN_SECRET;
      else process.env.PICKUP_TOKEN_SECRET = previous.pickupSecret;
      if (previous.encryptionKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
      else process.env.DATA_ENCRYPTION_KEY = previous.encryptionKey;
      if (previous.jwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previous.jwtSecret;
    }
  });

  it('买家读取凭证写入不含短码或 token 的限频审计', async () => {
    const pickupCode = '12345678';
    const pickupToken = 'token-that-must-never-enter-audit';
    const pickupFulfillmentEvent = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'event-view-1' }),
    };
    const prisma = {
      pickupFulfillment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pf1',
          orderId: 'o1',
          status: 'READY',
          pickupCredentialEncrypted: encryptJsonValue({ pickupCode, pickupToken }),
          pickupPointSnapshot: { name: '一号店', regionText: '北京市', detail: '1 号' },
          recipientSnapshot: encryptJsonValue({ recipientName: '王五', phone: '13712345678' }),
          order: { userId: 'u1', fulfillmentMode: 'PICKUP' },
        }),
      },
      pickupFulfillmentEvent,
    };
    const { service } = createService(prisma);

    const result = await service.getBuyerPass('u1', 'o1');

    expect(result.pickupCode).toBe(pickupCode);
    expect(pickupFulfillmentEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        fulfillmentId: 'pf1',
        eventType: 'BUYER_PASS_VIEWED',
        actorType: 'BUYER',
        actorId: 'u1',
      }),
    }));
    expect(pickupFulfillmentEvent.create).toHaveBeenCalledWith({
      data: {
        fulfillmentId: 'pf1',
        fromStatus: 'READY',
        toStatus: 'READY',
        eventType: 'BUYER_PASS_VIEWED',
        actorType: 'BUYER',
        actorId: 'u1',
      },
    });
    const auditPayload = JSON.stringify(pickupFulfillmentEvent.create.mock.calls);
    expect(auditPayload).not.toContain(pickupCode);
    expect(auditPayload).not.toContain(pickupToken);

    pickupFulfillmentEvent.findFirst.mockResolvedValueOnce({ id: 'recent-view' });
    await service.getBuyerPass('u1', 'o1');
    expect(pickupFulfillmentEvent.create).toHaveBeenCalledTimes(1);
  });

  it('自提点联系电话以长密文存储，所有者读取时解密', async () => {
    let createdData: any;
    const prisma = {
      company: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
      pickupPoint: {
        create: jest.fn(async ({ data }: any) => {
          createdData = data;
          return { id: 'p1', createdAt: new Date(), updatedAt: new Date(), ...data };
        }),
      },
    };
    const { service } = createService(prisma);
    const result = await service.createSellerPoint('c1', {
      name: '一号店', contactName: '张三', contactPhone: '13812345678',
      regionCode: '110000', regionText: '北京市', detail: '朝阳区 1 号',
      businessHours: { summary: '9:00-18:00' },
    });

    expect(createdData.contactPhone.length).toBeGreaterThan(32);
    expect(decryptText(createdData.contactPhone)).toBe('13812345678');
    expect(result.contactPhone).toBe('13812345678');
  });

  it('卖家可以显式清空可选的地图坐标', async () => {
    const current = {
      id: 'p1', companyId: 'c1', updatedAt: new Date('2026-08-14T19:00:00Z'),
    };
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'p1', companyId: 'c1', name: '一号店', contactName: '张三',
      contactPhone: '13812345678', regionCode: '110000', regionText: '北京市',
      detail: '1 号', location: null, businessHours: { summary: '9:00-18:00' },
      pickupNotice: null, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    });
    const tx = {
      pickupPoint: {
        findFirst: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow,
      },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const { service } = createService(prisma);

    await service.updateSellerPoint('c1', 'p1', { location: null, pickupNotice: '' });

    expect(tx.pickupPoint.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', companyId: 'c1', deletedAt: null, updatedAt: current.updatedAt },
      data: { location: Prisma.DbNull, pickupNotice: null },
    });
  });

  it('买家和卖家查询都排除平台已软删除的自提点', async () => {
    const prisma = {
      company: { findMany: jest.fn().mockResolvedValue([]) },
      pickupPoint: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const { service } = createService(prisma);

    await service.listBuyerPoints(['c1']);
    expect(prisma.company.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['c1'] }, status: 'ACTIVE' },
      select: { id: true, name: true },
    }));
    expect(prisma.pickupPoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isActive: true, deletedAt: null }),
    }));

    await service.listSellerPoints('c1');
    expect(prisma.pickupPoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: 'c1', deletedAt: null },
    }));
  });

  it('平台创建自提点时校验企业并在同一事务写完整审计', async () => {
    const createdAt = new Date('2026-08-14T20:00:00Z');
    const tx = {
      company: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
      pickupPoint: {
        create: jest.fn(async ({ data }: any) => ({
          id: 'p1', ...data, location: null, pickupNotice: null,
          deletedAt: null, deletedByAdminId: null, deleteReason: null,
          createdAt, updatedAt: createdAt,
          company: { id: 'c1', name: '商家一' },
        })),
      },
      adminAuditLog: { create: jest.fn().mockResolvedValue({ id: 'audit1' }) },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const { service } = createService(prisma);

    const result = await service.createAdminPoint({
      companyId: 'c1', name: '平台测试点', contactName: '张三', contactPhone: '13812345678',
      regionCode: '110000', regionText: '北京市', detail: '朝阳区 1 号',
      businessHours: { summary: '09:00-18:00' },
    }, { adminUserId: 'admin1', requestId: 'req1' });

    expect(tx.company.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1', status: 'ACTIVE' },
    }));
    expect(result.contactPhone).toBe('13812345678');
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminUserId: 'admin1', action: 'CREATE', module: 'pickup',
        targetType: 'PickupPoint', targetId: 'p1', requestId: 'req1',
        after: expect.any(Object), isReversible: false,
      }),
    });
    const auditPayload = JSON.stringify(tx.adminAuditLog.create.mock.calls);
    expect(auditPayload).not.toContain('13812345678');
    expect(auditPayload).not.toContain('张三');
  });

  it('平台中心仓忽略浏览器传入的企业并自动绑定唯一平台公司', async () => {
    let createdData: any;
    const now = new Date('2026-08-17T00:00:00Z');
    const tx = {
      company: { findMany: jest.fn().mockResolvedValue([{ id: 'platform-1', isPlatform: true }]) },
      pickupPoint: {
        create: jest.fn(async ({ data }: any) => {
          createdData = data;
          return {
            id: 'hub-1', ...data, location: null, pickupNotice: null,
            deletedAt: null, deletedByAdminId: null, deleteReason: null,
            createdAt: now, updatedAt: now,
            company: { id: 'platform-1', name: '爱买买app', isPlatform: true },
            serviceCompanies: [],
          };
        }),
      },
      adminAuditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const { service } = createService(prisma);

    await expect(service.createAdminPoint({
      // Even a stale/malicious browser value cannot choose the hub owner.
      companyId: 'merchant-1', kind: 'PLATFORM_HUB', coverage: 'ALL_ACTIVE_COMPANIES',
      name: '平台中心仓', contactName: '张三', contactPhone: '13812345678',
      regionCode: '110000', regionText: '北京市', detail: '朝阳区 1 号',
      businessHours: { summary: '09:00-18:00' },
    }, { adminUserId: 'admin1' })).resolves.toEqual(expect.objectContaining({ companyId: 'platform-1' }));
    expect(createdData.companyId).toBe('platform-1');
    expect(tx.company.findMany).toHaveBeenCalledWith({
      where: { isPlatform: true, status: 'ACTIVE' },
      select: { id: true, isPlatform: true },
      take: 2,
      orderBy: { id: 'asc' },
    });
  });

  it('平台列表默认隐藏已删除点位，并可单独筛选回收站', async () => {
    const prisma = {
      pickupPoint: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const { service } = createService(prisma);

    await service.listAdminPoints({ page: 1, pageSize: 20 });
    await service.listAdminPoints({ page: 1, pageSize: 20, isDeleted: true, companyId: 'c1' });

    expect(prisma.pickupPoint.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { deletedAt: null },
    }));
    expect(prisma.pickupPoint.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { deletedAt: { not: null }, companyId: 'c1' },
    }));
  });

  it('平台点位权限可独立读取最小企业选项，不依赖企业管理权限', async () => {
    const prisma = {
      company: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1', name: '商家一' }]),
      },
    };
    const { service } = createService(prisma);

    await expect(service.listAdminPickupCompanyOptions(' 商家 ')).resolves.toEqual({
      items: [{ id: 'c1', name: '商家一' }],
    });
    expect(prisma.company.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', name: { contains: '商家', mode: 'insensitive' } },
      select: { id: true, name: true, isPlatform: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 200,
    });
  });

  it('平台可完整编辑点位但不能绕过软删除和并发版本守门', async () => {
    const updatedAt = new Date('2026-08-14T20:00:00Z');
    const current = {
      id: 'p1', companyId: 'c1', name: '旧名称', contactName: '张三',
      contactPhone: encryptText('13812345678'), regionCode: '110000',
      regionText: '北京市', detail: '旧地址', location: { lng: 116, lat: 39 },
      businessHours: { summary: '09:00-18:00' }, pickupNotice: '旧须知',
      isActive: true, deletedAt: null, deletedByAdminId: null, deleteReason: null,
      createdAt: updatedAt, updatedAt, company: { id: 'c1', name: '商家一' },
    };
    const updatedPoint = {
      ...current, name: '新名称', location: null, pickupNotice: null,
      contactPhone: encryptText('13899995678'),
      updatedAt: new Date('2026-08-14T20:01:00Z'),
    };
    const tx = {
      pickupPoint: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updatedPoint),
      },
      adminAuditLog: { create: jest.fn().mockResolvedValue({ id: 'audit1' }) },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const { service } = createService(prisma);

    const result = await service.updateAdminPoint('p1', {
      name: '新名称', contactPhone: '13899995678', location: null,
      pickupNotice: '', reason: '平台纠正资料',
    }, { adminUserId: 'admin1' });

    expect(result.name).toBe('新名称');
    expect(tx.pickupPoint.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', deletedAt: null, updatedAt },
      data: {
        name: '新名称', contactPhone: expect.any(String),
        location: Prisma.DbNull, pickupNotice: null,
      },
    });
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'UPDATE', summary: expect.stringContaining('平台纠正资料'),
        before: expect.any(Object), after: expect.any(Object), diff: expect.any(Object),
      }),
    });
    const auditData = tx.adminAuditLog.create.mock.calls[0][0].data;
    expect(auditData.diff.contactPhone).toEqual({
      old: '138****5678',
      new: '138****5678',
      changed: true,
    });
    expect(JSON.stringify(auditData)).not.toContain('13812345678');
    expect(JSON.stringify(auditData)).not.toContain('13899995678');
  });

  it('平台软删除和恢复使用更新时间 CAS，恢复后保持停用', async () => {
    const updatedAt = new Date('2026-08-14T20:00:00Z');
    const deletedAt = new Date('2026-08-14T20:01:00Z');
    const base = {
      id: 'p1', companyId: 'c1', name: '一号店', contactName: '张三',
      contactPhone: encryptText('13812345678'), regionCode: '110000',
      regionText: '北京市', detail: '朝阳区 1 号', location: null,
      businessHours: { summary: '09:00-18:00' }, pickupNotice: null,
      isActive: true, deletedAt: null, deletedByAdminId: null, deleteReason: null,
      createdAt: updatedAt, updatedAt, company: { id: 'c1', name: '商家一' },
    };
    const deleted = {
      ...base, isActive: false, deletedAt, deletedByAdminId: 'admin1',
      deleteReason: '门店停止合作', updatedAt: deletedAt,
    };
    const restored = {
      ...deleted, deletedAt: null, deletedByAdminId: null, deleteReason: null,
      isActive: false, updatedAt: new Date('2026-08-14T20:02:00Z'),
    };
    const tx = {
      pickupPoint: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(base)
          .mockResolvedValueOnce(deleted),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn()
          .mockResolvedValueOnce(deleted)
          .mockResolvedValueOnce(restored),
      },
      adminAuditLog: { create: jest.fn().mockResolvedValue({ id: 'audit1' }) },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const { service } = createService(prisma);
    const audit = { adminUserId: 'admin1' };

    const deleteResult = await service.deleteAdminPoint('p1', '门店停止合作', audit);
    expect(deleteResult.deletedAt).toEqual(deletedAt);
    expect(tx.pickupPoint.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'p1', deletedAt: null, updatedAt },
      data: expect.objectContaining({
        isActive: false, deletedByAdminId: 'admin1', deleteReason: '门店停止合作',
      }),
    });

    const restoreResult = await service.restoreAdminPoint('p1', '重新开放申请', audit);
    expect(restoreResult.isActive).toBe(false);
    expect(tx.pickupPoint.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'p1', deletedAt, updatedAt: deleted.updatedAt },
      data: { isActive: false, deletedAt: null, deletedByAdminId: null, deleteReason: null },
    });
    expect(tx.adminAuditLog.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ action: 'DELETE', targetId: 'p1' }),
    });
    expect(tx.adminAuditLog.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ action: 'UPDATE', summary: expect.stringContaining('恢复') }),
    });
  });

  it('平台取消整个 session 时逐单作废 PREPARING 与 READY 凭证', async () => {
    const tx = {
      pickupFulfillment: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'pf1', status: 'PREPARING' },
          { id: 'pf2', status: 'READY' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pickupFulfillmentEvent: { create: jest.fn() },
    };
    const { service } = createService({});

    await service.voidForOrders(
      tx as any,
      ['o1', 'o2'],
      'CANCELED',
      '平台取消',
      'ADMIN',
      'admin1',
    );

    expect(tx.pickupFulfillment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        orderId: { in: ['o1', 'o2'] },
        status: { in: ['PREPARING', 'READY'] },
      },
    }));
    expect(tx.pickupFulfillment.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.pickupFulfillmentEvent.create).toHaveBeenCalledTimes(2);
  });

  it('READY 转换与通知 outbox 在同一事务，幂等重试仍重投同一键', async () => {
    const fulfillment: any = {
      id: 'pf1', status: 'READY', readyAt: new Date('2026-08-14T10:00:00Z'),
      order: { fulfillmentMode: 'PICKUP', status: 'PAID', items: [{ companyId: 'c1' }] },
    };
    const tx = { pickupFulfillment: { findUnique: jest.fn().mockResolvedValue(fulfillment) } };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const { service, notificationService } = createService(prisma);

    const result = await service.markReady('c1', 'staff1', 'o1');

    expect(result.alreadyReady).toBe(true);
    expect(notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'order.pickup_ready:o1' }),
      tx,
    );
  });

  it('核销以 CAS 将订单收口到 RECEIVED 并写入退换货窗口', async () => {
    const now = new Date('2026-08-14T10:00:00Z');
    jest.useFakeTimers().setSystemTime(now);
    const tx: any = {
      pickupFulfillment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pf1', status: 'READY', pickupCodeDigest: (null as any),
          order: {
            id: 'o1', userId: 'u1', fulfillmentMode: 'PICKUP', status: 'PAID',
            items: [{ companyId: 'c1', isPrize: false }],
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      pickupFulfillmentEvent: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
      ruleConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const { service } = createService(prisma);
    tx.pickupFulfillment.findUnique.mock.results;
    const code = '12345678';
    tx.pickupFulfillment.findUnique.mockResolvedValue({
      ...(await tx.pickupFulfillment.findUnique()),
      pickupCodeDigest: (service as any).digest(code),
    });
    jest.spyOn(service as any, 'dispatchPostReceiveSideEffects').mockResolvedValue(undefined);

    await service.verify('c1', 'staff1', 'o1', { pickupCode: code });

    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'o1', status: 'PAID', fulfillmentMode: 'PICKUP' },
      data: expect.objectContaining({
        status: 'RECEIVED',
        deliveredAt: now,
        returnWindowExpiresAt: expect.any(Date),
      }),
    }));
    jest.useRealTimers();
  });

  it('核销输入必须且只能提交短码或二维码中的一项', async () => {
    const { service } = createService({});

    await expect(service.verify('c1', 'staff1', 'o1', {}))
      .rejects.toThrow('必须且只能提交一项');
    await expect(service.verify('c1', 'staff1', 'o1', {
      pickupCode: '12345678',
      qrPayload: 'AIMMPICKUP.1.payload',
    }))
      .rejects.toThrow('必须且只能提交一项');
    await expect(service.verify('c1', 'staff1', 'o1', {
      pickupCode: {} as any,
      qrPayload: {} as any,
    }))
      .rejects.toThrow('必须且只能提交一项');
  });

  it('核销台先按买家二维码解析同企业订单，再由原子核销主链完成状态变更', async () => {
    const token = 'one-time-token-that-must-not-be-returned';
    const code = '12345678';
    const prisma = {
      pickupFulfillment: {
        findUnique: jest.fn(),
      },
    };
    const { service } = createService(prisma);
    const fulfillment = {
      id: 'pf1',
      orderId: 'o1',
      status: 'READY',
      pickupCodeDigest: (service as any).digest(code),
      pickupTokenDigest: (service as any).digest(token),
      pickupPointSnapshot: encryptJsonValue({
        id: 'p1', companyId: 'c1', name: '一号自提点', contactName: '张三',
        contactPhone: '13812345678', regionText: '北京市', detail: '朝阳区 1 号',
      }),
      recipientSnapshot: encryptJsonValue({ recipientName: '王五', phone: '13712345678' }),
      order: {
        id: 'o1', status: 'PAID', fulfillmentMode: 'PICKUP',
        items: [{
          companyId: 'c1', isPrize: false, quantity: 2,
          productSnapshot: { title: '番茄', skuTitle: '2斤装' },
          sku: { title: '2斤装', skuCode: 'SKU-1', barcode: '690000000001', product: { title: '番茄' } },
        }],
      },
    };
    prisma.pickupFulfillment.findUnique.mockResolvedValue(fulfillment);
    const qrPayload = (service as any).buildQrPayload(
      'pf1',
      token,
      Math.floor(Date.now() / 1000) + 60,
    );

    const preview = await service.resolveCredential('c1', { qrPayload });

    expect(preview).toMatchObject({
      orderId: 'o1', status: 'READY', alreadyPickedUp: false,
      pickupPoint: { name: '一号自提点' },
      recipient: { name: '王*', phoneMasked: '137****5678' },
      items: [{ title: '番茄', skuTitle: '2斤装', quantity: 2, barcode: '690000000001' }],
    });
    expect(JSON.stringify(preview)).not.toContain(token);
    expect(JSON.stringify(preview)).not.toContain(code);

    const verify = jest.spyOn(service, 'verify').mockResolvedValue({
      orderId: 'o1', status: 'PICKED_UP', pickedUpAt: new Date(), alreadyPickedUp: false,
    });
    await service.verifyCredential('c1', 'staff-1', { qrPayload });
    expect(verify).toHaveBeenCalledWith('c1', 'staff-1', 'o1', { qrPayload });
  });

  it('核销台全局短码查询对跨企业和短码碰撞均 fail closed', async () => {
    const { service } = createService({
      pickupFulfillment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pf1', orderId: 'o1', status: 'READY', pickupCodeDigest: 'unused',
            pickupPointSnapshot: encryptJsonValue({}), recipientSnapshot: encryptJsonValue({}),
            order: { status: 'PAID', fulfillmentMode: 'PICKUP', items: [{ companyId: 'other-company' }] },
          },
        ]),
      },
    });
    await expect(service.resolveCredential('c1', { pickupCode: '12345678' }))
      .rejects.toThrow('自提订单不存在');

    const collisionPrisma = {
      pickupFulfillment: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pf1' }, { id: 'pf2' }]),
      },
    };
    const collisionService = createService(collisionPrisma).service;
    await expect(collisionService.resolveCredential('c1', { pickupCode: '12345678' }))
      .rejects.toThrow('匹配到多个订单');
  });

  it('并发收货副作用通过持久化 claim 只执行一次', async () => {
    const events: Array<{ id: string; eventType: string; createdAt: Date }> = [];
    let sequence = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const tx = {
      pickupFulfillment: {
        findUnique: jest.fn(async () => ({
          id: 'pf1',
          status: 'PICKED_UP',
          events: [...events]
            .filter((event) => [
              'RECEIVE_SIDE_EFFECTS_PROCESSING',
              'RECEIVE_SIDE_EFFECTS_COMPLETED',
              'RECEIVE_SIDE_EFFECTS_FAILED',
            ].includes(event.eventType))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, 1),
        })),
      },
      pickupFulfillmentEvent: {
        create: jest.fn(async ({ data }: any) => {
          const event = { id: `e${++sequence}`, eventType: data.eventType, createdAt: new Date() };
          events.push(event);
          return event;
        }),
      },
    };
    const orderService = { handlePickupReceived: jest.fn(() => blocked) };
    const prisma = {
      $transaction: jest.fn((callback: any) => callback(tx)),
      pickupFulfillmentEvent: tx.pickupFulfillmentEvent,
    };
    const { service } = createService(prisma, orderService);

    const first = (service as any).dispatchPostReceiveSideEffects({ id: 'o1' });
    await Promise.resolve();
    await Promise.resolve();
    const second = (service as any).dispatchPostReceiveSideEffects({ id: 'o1' });
    await second;
    release();
    await first;

    expect(orderService.handlePickupReceived).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.eventType === 'RECEIVE_SIDE_EFFECTS_COMPLETED')).toHaveLength(1);
  });
});
