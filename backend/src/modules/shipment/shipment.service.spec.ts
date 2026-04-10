import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ShipmentService } from './shipment.service';

// --- 种子数据常量 ---
const BUYER_USER_ID = 'u-001'; // 林青禾
const OTHER_USER_ID = 'u-999'; // 其他用户
const COMPANY_C001 = 'c-001'; // 澄源生态农业
const COMPANY_C002 = 'c-002'; // 青禾智慧农场
const ORDER_PAID = 'o-001'; // PAID, 包含 c-001 和 c-002 的商品
const ORDER_SHIPPED = 'o-003'; // SHIPPED, 仅 c-003 的商品, SF1234567890
const ADDRESS_SNAPSHOT = {
  receiverName: '林青禾',
  phone: '13800138000',
  province: '云南省',
  city: '昆明市',
  district: '盘龙区',
  detail: '翠湖路 88 号爱买买大厦 12 楼',
};

// --- Mock 工厂 ---
function createMocks(configOverrides: Record<string, any> = {}) {
  const prisma: Record<string, any> = {
    order: { findUnique: jest.fn(), updateMany: jest.fn() },
    shipment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    shipmentTrackingEvent: {
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
    orderStatusHistory: { create: jest.fn() },
    ruleConfig: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  const configService = {
    get: jest.fn((key: string, defaultVal?: any) => {
      const config: Record<string, any> = {
        LOGISTICS_WEBHOOK_SECRET: 'test-secret',
        KUAIDI100_CALLBACK_TOKEN: 'test-token',
        ...configOverrides,
      };
      return config[key] ?? defaultVal;
    }),
  };
  const kuaidi100Service = {
    queryTracking: jest.fn(),
    parseCallbackPayload: jest.fn(),
  };
  const service = new ShipmentService(
    prisma as any,
    configService as any,
    kuaidi100Service as any,
  );
  return { service, prisma, configService, kuaidi100Service };
}

// 辅助: 构建 shipment 记录
function makeShipment(overrides: Record<string, any> = {}) {
  return {
    id: 'shp-001',
    orderId: ORDER_SHIPPED,
    companyId: COMPANY_C001,
    carrierCode: 'SF',
    carrierName: '顺丰速运',
    trackingNo: 'SF1234567890',
    status: 'SHIPPED',
    shippedAt: new Date('2026-04-01T10:00:00Z'),
    createdAt: new Date('2026-04-01T09:00:00Z'),
    deliveredAt: null,
    receiverInfoSnapshot: ADDRESS_SNAPSHOT,
    trackingEvents: [],
    ...overrides,
  };
}

// 辅助: 构建 HMAC 签名（与 service 中逻辑一致）
function computeHmacSignature(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const crypto = require('crypto');
  const canonicalPayload = JSON.stringify(
    payload,
    Object.keys(payload).sort(),
  );
  return crypto.createHmac('sha256', secret).update(canonicalPayload).digest('hex');
}

// =========================================================================
// R5: 快递100回调更新物流轨迹
// =========================================================================
describe('handleCallback — 物流回调处理', () => {
  it('收到揽件状态，Shipment 更新为 IN_TRANSIT', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'SHIPPED' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue({ ...shipment, status: 'IN_TRANSIT' });
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);
    prisma.shipmentTrackingEvent.createMany.mockResolvedValue({ count: 1 });

    const result = await service.handleCallback(
      'SF1234567890',
      'IN_TRANSIT',
      [{ time: '2026-04-02T08:00:00Z', message: '快件已揽收' }],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    expect(result).toEqual({ ok: true });
    expect(prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shp-001' },
        data: expect.objectContaining({ status: 'IN_TRANSIT' }),
      }),
    );
  });

  it('收到签收状态，Shipment 更新为 DELIVERED，设置 deliveredAt', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'IN_TRANSIT' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue({ ...shipment, status: 'DELIVERED' });
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);
    prisma.shipmentTrackingEvent.createMany.mockResolvedValue({ count: 1 });
    // 全部签收 → Order 联动
    prisma.shipment.count.mockResolvedValue(0);
    prisma.ruleConfig.findUnique.mockResolvedValue({ key: 'RETURN_WINDOW_DAYS', value: 7 });
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderStatusHistory.create.mockResolvedValue({});

    const result = await service.handleCallback(
      'SF1234567890',
      'DELIVERED',
      [{ time: '2026-04-05T14:00:00Z', message: '已签收，签收人：本人' }],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    expect(result).toEqual({ ok: true });
    expect(prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
        }),
      }),
    );
  });

  it('未知状态保持原 Shipment 状态不变', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'IN_TRANSIT' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue(shipment);
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);

    await service.handleCallback(
      'SF1234567890',
      'SOME_UNKNOWN_STATUS',
      [],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    // 状态应保持为原来的 IN_TRANSIT（因为 status 不匹配 DELIVERED 和 IN_TRANSIT）
    expect(prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_TRANSIT' }),
      }),
    );
  });

  it('trackingNo 不存在时抛 NotFoundException', async () => {
    const { service, prisma } = createMocks();
    prisma.shipment.findFirst.mockResolvedValue(null);

    await expect(
      service.handleCallback(
        'NONEXISTENT123',
        'IN_TRANSIT',
        [],
        undefined,
        undefined,
        { skipSignatureVerification: true },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// =========================================================================
// R6: 全部包裹签收 → Order 联动 DELIVERED
// =========================================================================
describe('handleCallback — Order 状态联动', () => {
  it('单包裹订单签收 → Order SHIPPED→DELIVERED + returnWindowExpiresAt 设置', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'IN_TRANSIT' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue({ ...shipment, status: 'DELIVERED' });
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);
    // 所有包裹已签收（count=0 表示没有未签收的）
    prisma.shipment.count.mockResolvedValue(0);
    prisma.ruleConfig.findUnique.mockResolvedValue({ key: 'RETURN_WINDOW_DAYS', value: 7 });
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderStatusHistory.create.mockResolvedValue({});

    await service.handleCallback(
      'SF1234567890',
      'DELIVERED',
      [{ time: '2026-04-05T14:00:00Z', message: '已签收' }],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORDER_SHIPPED, status: 'SHIPPED' },
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
          returnWindowExpiresAt: expect.any(Date),
        }),
      }),
    );

    // 验证 returnWindowExpiresAt 大约在 7 天后
    const updateCall = prisma.order.updateMany.mock.calls[0][0];
    const deliveredAt = updateCall.data.deliveredAt as Date;
    const expiresAt = updateCall.data.returnWindowExpiresAt as Date;
    const diffDays = (expiresAt.getTime() - deliveredAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(7, 0);
  });

  it('多包裹订单部分签收 → Order 保持 SHIPPED（undeliveredCount > 0）', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'IN_TRANSIT' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue({ ...shipment, status: 'DELIVERED' });
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);
    // 还有 1 个包裹未签收
    prisma.shipment.count.mockResolvedValue(1);

    await service.handleCallback(
      'SF1234567890',
      'DELIVERED',
      [{ time: '2026-04-05T14:00:00Z', message: '已签收' }],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    // Order 不应被更新
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('多包裹订单全部签收 → Order SHIPPED→DELIVERED', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'IN_TRANSIT' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue({ ...shipment, status: 'DELIVERED' });
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);
    // 全部签收
    prisma.shipment.count.mockResolvedValue(0);
    prisma.ruleConfig.findUnique.mockResolvedValue({ key: 'RETURN_WINDOW_DAYS', value: 7 });
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderStatusHistory.create.mockResolvedValue({});

    await service.handleCallback(
      'SF1234567890',
      'DELIVERED',
      [{ time: '2026-04-05T14:00:00Z', message: '已签收' }],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORDER_SHIPPED, status: 'SHIPPED' },
        data: expect.objectContaining({ status: 'DELIVERED' }),
      }),
    );
    expect(prisma.orderStatusHistory.create).toHaveBeenCalled();
  });

  it('Order 已不在 SHIPPED 状态（CAS 失败）→ 不记录 OrderStatusHistory', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'IN_TRANSIT' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue({ ...shipment, status: 'DELIVERED' });
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);
    prisma.shipment.count.mockResolvedValue(0);
    prisma.ruleConfig.findUnique.mockResolvedValue({ key: 'RETURN_WINDOW_DAYS', value: 7 });
    // CAS 失败：count=0 表示没有匹配的行被更新
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await service.handleCallback(
      'SF1234567890',
      'DELIVERED',
      [{ time: '2026-04-05T14:00:00Z', message: '已签收' }],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    expect(prisma.order.updateMany).toHaveBeenCalled();
    // CAS 失败时不记录状态历史
    expect(prisma.orderStatusHistory.create).not.toHaveBeenCalled();
  });

  it('OrderStatusHistory 记录正确的状态转换信息', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'IN_TRANSIT' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue({ ...shipment, status: 'DELIVERED' });
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);
    prisma.shipment.count.mockResolvedValue(0);
    prisma.ruleConfig.findUnique.mockResolvedValue({ key: 'RETURN_WINDOW_DAYS', value: 7 });
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderStatusHistory.create.mockResolvedValue({});

    await service.handleCallback(
      'SF1234567890',
      'DELIVERED',
      [],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        orderId: ORDER_SHIPPED,
        fromStatus: 'SHIPPED',
        toStatus: 'DELIVERED',
        reason: '物流签收',
      },
    });
  });
});

// =========================================================================
// R7: 买家主动查询联动 Order
// =========================================================================
describe('queryTrackingFromKuaidi100 — 主动查询', () => {
  it('调用快递100查询并更新 Shipment 状态', async () => {
    const { service, prisma, kuaidi100Service } = createMocks();
    const shipment = makeShipment({ status: 'SHIPPED', trackingEvents: [] });

    // 第一次调用: queryTrackingFromKuaidi100 中的 order 和 shipment 查询
    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
      status: 'SHIPPED',
    });
    prisma.shipment.findMany
      .mockResolvedValueOnce([shipment]) // queryTrackingFromKuaidi100 内部查询
      .mockResolvedValueOnce([{ ...shipment, status: 'IN_TRANSIT', trackingEvents: [{ id: 'evt-1', occurredAt: new Date('2026-04-02T08:00:00Z'), message: '快件已揽收', location: '昆明', statusCode: 'IN_TRANSIT' }] }]); // getByOrderId 内部查询

    kuaidi100Service.queryTracking.mockResolvedValue({
      status: 'IN_TRANSIT',
      rawState: '0',
      events: [{ time: '2026-04-02T08:00:00Z', message: '快件已揽收', location: '昆明' }],
    });
    prisma.shipment.update.mockResolvedValue({ ...shipment, status: 'IN_TRANSIT' });
    prisma.shipmentTrackingEvent.createMany.mockResolvedValue({ count: 1 });

    const result = await service.queryTrackingFromKuaidi100(ORDER_SHIPPED, BUYER_USER_ID);

    // ShipmentService 传递完整手机号，kuaidi100Service 内部取后4位
    expect(kuaidi100Service.queryTracking).toHaveBeenCalledWith('SF', 'SF1234567890', '13800138000');
    expect(prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_TRANSIT' }),
      }),
    );
  });

  it('签收时同样联动 Order SHIPPED→DELIVERED', async () => {
    const { service, prisma, kuaidi100Service } = createMocks();
    const shipment = makeShipment({ status: 'IN_TRANSIT', trackingEvents: [] });

    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
      status: 'SHIPPED',
    });
    prisma.shipment.findMany
      .mockResolvedValueOnce([shipment])
      .mockResolvedValueOnce([{ ...shipment, status: 'DELIVERED', trackingEvents: [] }]);

    kuaidi100Service.queryTracking.mockResolvedValue({
      status: 'DELIVERED',
      rawState: '3',
      events: [{ time: '2026-04-05T14:00:00Z', message: '已签收' }],
    });
    prisma.shipment.update.mockResolvedValue({ ...shipment, status: 'DELIVERED' });
    prisma.shipmentTrackingEvent.createMany.mockResolvedValue({ count: 1 });
    prisma.shipment.count.mockResolvedValue(0);
    prisma.ruleConfig.findUnique.mockResolvedValue({ key: 'RETURN_WINDOW_DAYS', value: 7 });
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.orderStatusHistory.create.mockResolvedValue({});

    await service.queryTrackingFromKuaidi100(ORDER_SHIPPED, BUYER_USER_ID);

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORDER_SHIPPED, status: 'SHIPPED' },
        data: expect.objectContaining({ status: 'DELIVERED' }),
      }),
    );
    expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        orderId: ORDER_SHIPPED,
        fromStatus: 'SHIPPED',
        toStatus: 'DELIVERED',
        reason: '物流签收（主动查询）',
      },
    });
  });

  it('已签收的 Shipment 不回退状态', async () => {
    const { service, prisma, kuaidi100Service } = createMocks();
    const shipment = makeShipment({
      status: 'DELIVERED',
      deliveredAt: new Date('2026-04-05T14:00:00Z'),
      trackingEvents: [
        {
          id: 'evt-1',
          occurredAt: new Date('2026-04-05T14:00:00Z'),
          message: '已签收',
          location: null,
          statusCode: 'DELIVERED',
        },
      ],
    });

    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
      status: 'DELIVERED',
    });
    prisma.shipment.findMany
      .mockResolvedValueOnce([shipment])
      .mockResolvedValueOnce([shipment]);

    // 快递100返回 IN_TRANSIT，但 Shipment 已 DELIVERED，不应回退
    kuaidi100Service.queryTracking.mockResolvedValue({
      status: 'IN_TRANSIT',
      rawState: '0',
      events: [{ time: '2026-04-05T14:00:00Z', message: '已签收' }],
    });

    await service.queryTrackingFromKuaidi100(ORDER_SHIPPED, BUYER_USER_ID);

    // 不应更新 Shipment 状态
    expect(prisma.shipment.update).not.toHaveBeenCalled();
  });

  it('新事件写入，已有事件跳过（去重）', async () => {
    const { service, prisma, kuaidi100Service } = createMocks();
    const existingEvent = {
      id: 'evt-existing',
      occurredAt: new Date('2026-04-02T08:00:00Z'),
      message: '快件已揽收',
      location: '昆明',
      statusCode: 'IN_TRANSIT',
    };
    const shipment = makeShipment({
      status: 'IN_TRANSIT',
      trackingEvents: [existingEvent],
    });

    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
      status: 'SHIPPED',
    });
    prisma.shipment.findMany
      .mockResolvedValueOnce([shipment])
      .mockResolvedValueOnce([shipment]);

    kuaidi100Service.queryTracking.mockResolvedValue({
      status: 'IN_TRANSIT',
      rawState: '0',
      events: [
        { time: '2026-04-02T08:00:00Z', message: '快件已揽收', location: '昆明' }, // 已存在
        { time: '2026-04-03T10:00:00Z', message: '快件到达【北京转运中心】', location: '北京' }, // 新事件
      ],
    });
    prisma.shipmentTrackingEvent.createMany.mockResolvedValue({ count: 1 });

    await service.queryTrackingFromKuaidi100(ORDER_SHIPPED, BUYER_USER_ID);

    // 只写入新事件
    expect(prisma.shipmentTrackingEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          shipmentId: 'shp-001',
          message: '快件到达【北京转运中心】',
        }),
      ],
    });
  });

  it('快递100返回 null 时不更新', async () => {
    const { service, prisma, kuaidi100Service } = createMocks();
    const shipment = makeShipment({ status: 'SHIPPED', trackingEvents: [] });

    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
      status: 'SHIPPED',
    });
    prisma.shipment.findMany
      .mockResolvedValueOnce([shipment])
      .mockResolvedValueOnce([shipment]);

    kuaidi100Service.queryTracking.mockResolvedValue(null);

    await service.queryTrackingFromKuaidi100(ORDER_SHIPPED, BUYER_USER_ID);

    expect(prisma.shipment.update).not.toHaveBeenCalled();
    expect(prisma.shipmentTrackingEvent.createMany).not.toHaveBeenCalled();
  });

  it('无运单号的包裹跳过', async () => {
    const { service, prisma, kuaidi100Service } = createMocks();
    const shipmentNoTracking = makeShipment({
      trackingNo: null,
      trackingEvents: [],
    });

    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
      status: 'SHIPPED',
    });
    prisma.shipment.findMany
      .mockResolvedValueOnce([shipmentNoTracking])
      .mockResolvedValueOnce([shipmentNoTracking]);

    await service.queryTrackingFromKuaidi100(ORDER_SHIPPED, BUYER_USER_ID);

    // 不应调用快递100查询
    expect(kuaidi100Service.queryTracking).not.toHaveBeenCalled();
  });

  it('顺丰包裹传递手机号后4位', async () => {
    const { service, prisma, kuaidi100Service } = createMocks();
    const shipment = makeShipment({
      carrierCode: 'SF',
      receiverInfoSnapshot: { phone: '13800138000' },
      trackingEvents: [],
    });

    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
      status: 'SHIPPED',
    });
    prisma.shipment.findMany
      .mockResolvedValueOnce([shipment])
      .mockResolvedValueOnce([shipment]);

    kuaidi100Service.queryTracking.mockResolvedValue(null);

    await service.queryTrackingFromKuaidi100(ORDER_SHIPPED, BUYER_USER_ID);

    // 验证传递了手机号（完整号码，queryTracking 内部取后4位）
    expect(kuaidi100Service.queryTracking).toHaveBeenCalledWith(
      'SF',
      'SF1234567890',
      '13800138000',
    );
  });

  it('非顺丰包裹不传递手机号', async () => {
    const { service, prisma, kuaidi100Service } = createMocks();
    const shipment = makeShipment({
      carrierCode: 'YTO',
      carrierName: '圆通快递',
      trackingNo: 'YT1234567890',
      receiverInfoSnapshot: { phone: '13800138000' },
      trackingEvents: [],
    });

    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
      status: 'SHIPPED',
    });
    prisma.shipment.findMany
      .mockResolvedValueOnce([shipment])
      .mockResolvedValueOnce([shipment]);

    kuaidi100Service.queryTracking.mockResolvedValue(null);

    await service.queryTrackingFromKuaidi100(ORDER_SHIPPED, BUYER_USER_ID);

    // 非顺丰不传手机号
    expect(kuaidi100Service.queryTracking).toHaveBeenCalledWith(
      'YTO',
      'YT1234567890',
      undefined,
    );
  });
});

// =========================================================================
// R8: 轨迹去重
// =========================================================================
describe('handleCallback — 轨迹事件去重', () => {
  it('已存在相同 occurredAt+message 的事件不重复插入', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'IN_TRANSIT' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue(shipment);
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([
      {
        occurredAt: new Date('2026-04-02T08:00:00Z'),
        message: '快件已揽收',
      },
    ]);
    prisma.shipmentTrackingEvent.createMany.mockResolvedValue({ count: 1 });

    await service.handleCallback(
      'SF1234567890',
      'IN_TRANSIT',
      [
        { time: '2026-04-02T08:00:00Z', message: '快件已揽收' }, // 已存在
        { time: '2026-04-03T10:00:00Z', message: '到达北京分拣中心' }, // 新
      ],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    expect(prisma.shipmentTrackingEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          shipmentId: 'shp-001',
          message: '到达北京分拣中心',
          occurredAt: new Date('2026-04-03T10:00:00Z'),
        }),
      ],
    });
  });

  it('新事件正常插入', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'SHIPPED' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue(shipment);
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);
    prisma.shipmentTrackingEvent.createMany.mockResolvedValue({ count: 2 });

    await service.handleCallback(
      'SF1234567890',
      'IN_TRANSIT',
      [
        { time: '2026-04-02T08:00:00Z', message: '快件已揽收' },
        { time: '2026-04-03T10:00:00Z', message: '到达北京分拣中心' },
      ],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    expect(prisma.shipmentTrackingEvent.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ message: '快件已揽收' }),
        expect.objectContaining({ message: '到达北京分拣中心' }),
      ]),
    });
  });

  it('全部重复时 createMany 不调用', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment({ status: 'IN_TRANSIT' });
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue(shipment);
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([
      { occurredAt: new Date('2026-04-02T08:00:00Z'), message: '快件已揽收' },
      { occurredAt: new Date('2026-04-03T10:00:00Z'), message: '到达北京分拣中心' },
    ]);

    await service.handleCallback(
      'SF1234567890',
      'IN_TRANSIT',
      [
        { time: '2026-04-02T08:00:00Z', message: '快件已揽收' },
        { time: '2026-04-03T10:00:00Z', message: '到达北京分拣中心' },
      ],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    expect(prisma.shipmentTrackingEvent.createMany).not.toHaveBeenCalled();
  });
});

// =========================================================================
// R13: 买家查看物流
// =========================================================================
describe('getByOrderId — 查看物流信息', () => {
  it('订单归属验证（userId 不匹配抛 NotFoundException）', async () => {
    const { service, prisma } = createMocks();
    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: OTHER_USER_ID, // 不是买家
    });

    await expect(
      service.getByOrderId(ORDER_SHIPPED, BUYER_USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('订单不存在时抛 NotFoundException', async () => {
    const { service, prisma } = createMocks();
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(
      service.getByOrderId('nonexistent-order', BUYER_USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('单包裹返回完整轨迹', async () => {
    const { service, prisma } = createMocks();
    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
    });

    const events = [
      {
        id: 'evt-2',
        occurredAt: new Date('2026-04-05T14:00:00Z'),
        message: '已签收',
        location: '昆明',
        statusCode: 'DELIVERED',
      },
      {
        id: 'evt-1',
        occurredAt: new Date('2026-04-02T08:00:00Z'),
        message: '快件已揽收',
        location: '云南',
        statusCode: 'IN_TRANSIT',
      },
    ];
    prisma.shipment.findMany.mockResolvedValue([
      makeShipment({
        status: 'DELIVERED',
        deliveredAt: new Date('2026-04-05T14:00:00Z'),
        trackingEvents: events,
      }),
    ]);

    const result = await service.getByOrderId(ORDER_SHIPPED, BUYER_USER_ID);

    expect(result).not.toBeNull();
    expect(result!.carrierCode).toBe('SF');
    expect(result!.carrierName).toBe('顺丰速运');
    expect(result!.trackingNo).toBe('SF1234567890');
    expect(result!.status).toBe('DELIVERED');
    expect(result!.events).toHaveLength(2);
    expect(result!.shipments).toHaveLength(1);
  });

  it('多包裹返回聚合状态（carrierName 显示包裹数量）', async () => {
    const { service, prisma } = createMocks();
    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
    });

    prisma.shipment.findMany.mockResolvedValue([
      makeShipment({
        id: 'shp-001',
        status: 'DELIVERED',
        deliveredAt: new Date('2026-04-05T14:00:00Z'),
        trackingEvents: [
          {
            id: 'evt-1',
            occurredAt: new Date('2026-04-05T14:00:00Z'),
            message: '已签收',
            location: '昆明',
            statusCode: 'DELIVERED',
          },
        ],
      }),
      makeShipment({
        id: 'shp-002',
        companyId: COMPANY_C002,
        carrierCode: 'YTO',
        carrierName: '圆通快递',
        trackingNo: 'YT9876543210',
        status: 'IN_TRANSIT',
        trackingEvents: [
          {
            id: 'evt-2',
            occurredAt: new Date('2026-04-04T10:00:00Z'),
            message: '快件已揽收',
            location: '云南',
            statusCode: 'IN_TRANSIT',
          },
        ],
      }),
    ]);

    const result = await service.getByOrderId(ORDER_SHIPPED, BUYER_USER_ID);

    expect(result).not.toBeNull();
    expect(result!.carrierCode).toBe('MULTI');
    expect(result!.carrierName).toBe('2个包裹');
    expect(result!.trackingNo).toBe('多包裹');
    expect(result!.trackingNoMasked).toBeNull();
    // 部分签收 → 聚合状态为 IN_TRANSIT
    expect(result!.status).toBe('IN_TRANSIT');
    expect(result!.shipments).toHaveLength(2);
    // 事件来自两个包裹
    expect(result!.events).toHaveLength(2);
  });

  it('无物流信息返回 null', async () => {
    const { service, prisma } = createMocks();
    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_PAID,
      userId: BUYER_USER_ID,
    });
    prisma.shipment.findMany.mockResolvedValue([]);

    const result = await service.getByOrderId(ORDER_PAID, BUYER_USER_ID);
    expect(result).toBeNull();
  });

  it('trackingNo 脱敏（maskTrackingNo）', async () => {
    const { service, prisma } = createMocks();
    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_SHIPPED,
      userId: BUYER_USER_ID,
    });

    prisma.shipment.findMany.mockResolvedValue([
      makeShipment({
        trackingNo: 'SF1234567890',
        trackingEvents: [],
      }),
    ]);

    const result = await service.getByOrderId(ORDER_SHIPPED, BUYER_USER_ID);

    expect(result).not.toBeNull();
    // maskTrackingNo('SF1234567890') → 'SF12***7890'
    expect(result!.trackingNoMasked).toBe('SF12***7890');
    // 原始 trackingNo 也返回（用于复制）
    expect(result!.trackingNo).toBe('SF1234567890');
  });
});

// =========================================================================
// 签名验证
// =========================================================================
describe('handleCallback — 签名验证', () => {
  it('skipSignatureVerification=true 时跳过签名校验', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment();
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue(shipment);
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);

    // 不提供签名也能通过
    const result = await service.handleCallback(
      'SF1234567890',
      'IN_TRANSIT',
      [],
      undefined,
      undefined,
      { skipSignatureVerification: true },
    );

    expect(result).toEqual({ ok: true });
  });

  it('不跳过签名且签名无效时抛 UnauthorizedException', async () => {
    const { service } = createMocks();

    await expect(
      service.handleCallback(
        'SF1234567890',
        'IN_TRANSIT',
        [],
        { trackingNo: 'SF1234567890', status: 'IN_TRANSIT' },
        'invalid-signature',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('有效 HMAC 签名通过验证', async () => {
    const { service, prisma } = createMocks();
    const shipment = makeShipment();
    prisma.shipment.findFirst.mockResolvedValue(shipment);
    prisma.shipment.update.mockResolvedValue(shipment);
    prisma.shipmentTrackingEvent.findMany.mockResolvedValue([]);

    const payload = { trackingNo: 'SF1234567890', status: 'IN_TRANSIT' };
    const signature = computeHmacSignature(payload, 'test-secret');

    const result = await service.handleCallback(
      'SF1234567890',
      'IN_TRANSIT',
      [],
      { ...payload, signature },
      undefined,
    );

    expect(result).toEqual({ ok: true });
  });
});
