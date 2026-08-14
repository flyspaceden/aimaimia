import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decryptJsonValue, decryptText, encryptJsonValue } from '../../common/security/encryption';
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
      where: { id: { in: ['p1', 'p2'] }, isActive: true },
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
    const update = jest.fn().mockResolvedValue({
      id: 'p1', companyId: 'c1', name: '一号店', contactName: '张三',
      contactPhone: '13812345678', regionCode: '110000', regionText: '北京市',
      detail: '1 号', location: null, businessHours: { summary: '9:00-18:00' },
      pickupNotice: null, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    });
    const prisma = {
      pickupPoint: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p1', companyId: 'c1' }),
        update,
      },
    };
    const { service } = createService(prisma);

    await service.updateSellerPoint('c1', 'p1', { location: null, pickupNotice: '' });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { location: Prisma.DbNull, pickupNotice: null },
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
