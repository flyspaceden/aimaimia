/**
 * SellerShippingService 单元测试
 *
 * 覆盖面单生命周期：生成、取消、打印链接签名验证、批量操作、多商家隔离
 * 使用种子数据值模拟真实场景
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SellerShippingService } from './seller-shipping.service';

// mock 加密模块：测试环境下直接透传
jest.mock('../../../common/security/encryption', () => ({
  decryptJsonValue: jest.fn((v: unknown) => v),
}));

// mock 隐私掩码模块：测试环境下简化掩码
jest.mock('../../../common/security/privacy-mask', () => ({
  maskTrackingNo: jest.fn((v: string) => (v && v.length > 8 ? `${v.slice(0, 4)}***${v.slice(-4)}` : v)),
  maskIp: jest.fn((v?: string) => v || null),
}));

/* ------------------------------------------------------------------ */
/*  种子数据                                                           */
/* ------------------------------------------------------------------ */
const COMPANY_ID = 'c-001'; // 澄源生态农业
const STAFF_ID = 'cs-001';  // OWNER staff
const ORDER_PAID = 'o-001'; // PAID 状态
const ORDER_SHIPPED = 'o-003'; // SHIPPED 状态
const ORDER_RECEIVED = 'o-004'; // RECEIVED 状态
const COMPANY_C002 = 'c-002'; // 青禾智慧农场

const ADDRESS_SNAPSHOT = {
  receiverName: '林青禾',
  phone: '13800138000',
  province: '云南省',
  city: '昆明市',
  district: '盘龙区',
  detail: '翠湖路 88 号爱买买大厦 12 楼',
};

const COMPANY_INFO = {
  name: '澄源生态农业',
  servicePhone: '13800001001',
  address: {
    lng: 102.8,
    lat: 24.35,
    text: '云南省玉溪市红塔区',
    province: '云南省',
    city: '玉溪市',
    district: '红塔区',
    detail: '高新技术产业园区',
  },
  contact: { name: '张经理', phone: '13800001001' },
};

/* ------------------------------------------------------------------ */
/*  Mock 构建工厂                                                      */
/* ------------------------------------------------------------------ */

function createMocks() {
  const prisma: any = {
    order: { findUnique: jest.fn() },
    orderItem: { findMany: jest.fn() },
    shipment: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    company: { findUnique: jest.fn() },
    sellerAuditLog: { create: jest.fn() },
    $executeRaw: jest.fn(), // pg_advisory_xact_lock
  };
  prisma.$transaction = jest.fn((fn: any, _opts?: any) => fn(prisma));

  const configService = {
    get: jest.fn((key: string, defaultVal?: any) => {
      if (key === 'API_PREFIX') return '/api/v1';
      return defaultVal;
    }),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'SELLER_JWT_SECRET') return 'test-seller-secret';
      throw new Error(`Missing config: ${key}`);
    }),
  };

  const sellerRiskControl = {
    assertFeatureAllowed: jest.fn(),
  };

  const sfExpress = {
    createOrder: jest.fn(),
    cancelOrder: jest.fn(),
    printWaybill: jest.fn().mockResolvedValue({ pdfBase64: 'test-pdf-base64' }),
  };

  const service = new SellerShippingService(
    prisma as any,
    configService as any,
    sellerRiskControl as any,
    sfExpress as any,
  );

  return { service, prisma, sfExpress, sellerRiskControl, configService };
}

/**
 * 通用 mock 设置：模拟一个可正常生成面单的 PAID 订单
 */
function setupHappyPath(prisma: any, sfExpress: any, overrides?: {
  orderStatus?: string;
  orderId?: string;
  companyId?: string;
  existingShipment?: any;
}) {
  const orderId = overrides?.orderId ?? ORDER_PAID;
  const companyId = overrides?.companyId ?? COMPANY_ID;
  const status = overrides?.orderStatus ?? 'PAID';

  prisma.order.findUnique.mockResolvedValue({
    id: orderId,
    status,
    addressSnapshot: ADDRESS_SNAPSHOT,
  });

  prisma.orderItem.findMany.mockResolvedValue([
    {
      companyId,
      quantity: 2,
      sku: { product: { title: '有机苹果' } },
    },
    {
      companyId,
      quantity: 1,
      sku: { product: { title: '云南普洱茶' } },
    },
  ]);

  prisma.shipment.findUnique.mockResolvedValue(overrides?.existingShipment ?? null);
  prisma.shipment.create.mockResolvedValue({ id: 'ship-new' });
  prisma.shipment.updateMany.mockResolvedValue({ count: 1 });

  prisma.company.findUnique.mockResolvedValue(COMPANY_INFO);

  sfExpress.createOrder.mockResolvedValue({
    waybillNo: 'SF1234567890',
    sfOrderId: 'sf-order-abc-123',
    originCode: '755',
    destCode: '871',
  });

  sfExpress.cancelOrder.mockResolvedValue({ success: true });
}

/* ================================================================== */
/*  R1: 生成电子面单                                                    */
/* ================================================================== */

describe('generateWaybill — 面单生成', () => {
  it('正常流程：PAID 订单生成面单，返回 waybillNo + printUrl', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);

    const result = await service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF');

    expect(result.ok).toBe(true);
    expect(result.waybillNo).toBeDefined();
    // waybillNo 应该被掩码（maskTrackingNo）
    expect(result.waybillNo).toContain('***');
    expect(result.waybillPrintUrl).toContain('/seller/orders/');
    expect(result.carrierCode).toBe('SF');
    expect(result.carrierName).toBe('顺丰速运');
  });

  it('carrierCode 映射：SF → 顺丰速运', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);

    const result = await service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF');
    expect(result.carrierName).toBe('顺丰速运');
  });

  it('任何 carrierCode 输入统一使用顺丰', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);

    // 传入 ZTO 但因只支持顺丰，统一转为 SF
    const result = await service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'ZTO');
    expect(result.carrierName).toBe('顺丰速运');
    expect(result.carrierCode).toBe('SF');
  });

  it('Shipment 记录创建包含 sfOrderId', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);

    await service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF');

    expect(prisma.shipment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: ORDER_PAID,
        companyId: COMPANY_ID,
        carrierCode: 'SF',
        carrierName: '顺丰速运',
        waybillNo: 'SF1234567890',
        sfOrderId: 'sf-order-abc-123',
        status: 'INIT',
      }),
    });
  });

  it('已有面单的订单拒绝重复生成（幂等性）', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress, {
      existingShipment: {
        id: 'ship-existing',
        waybillNo: 'SF9999999999', // 已有面单
        status: 'INIT',
      },
    });

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow('该订单已生成面单，请勿重复操作');
  });

  it('非 PAID/SHIPPED 状态订单拒绝生成', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress, { orderStatus: 'RECEIVED' });

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_RECEIVED, 'SF'),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_RECEIVED, 'SF'),
    ).rejects.toThrow('只有已付款或部分已发货订单可生成面单');
  });

  it('CANCELLED 状态订单拒绝生成', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress, { orderStatus: 'CANCELLED' });

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow('只有已付款或部分已发货订单可生成面单');
  });

  it('非本企业商品的订单拒绝生成（ForbiddenException）', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);

    // orderItem 全属于 c-002，但请求来自 c-001
    prisma.orderItem.findMany.mockResolvedValue([
      { companyId: COMPANY_C002, quantity: 1, sku: { product: { title: '测试' } } },
    ]);

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow('无权操作该订单');
  });

  it('订单不存在时抛出 NotFoundException', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, 'o-nonexistent', 'SF'),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, 'o-nonexistent', 'SF'),
    ).rejects.toThrow('订单不存在');
  });

  it('顺丰 API 失败时回滚（rollbackCreatedWaybill 调用 cancelWaybill）', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);

    // 顺丰创建成功，但后续 shipment.create 失败
    prisma.shipment.create.mockRejectedValue(new Error('DB write error'));

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow('DB write error');

    // 应该回滚：调用 cancelOrder
    expect(sfExpress.cancelOrder).toHaveBeenCalledWith('sf-order-abc-123', 'SF1234567890');
  });

  it('existingShipment 存在但无 waybillNo 时走 updateMany 而非 create', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress, {
      existingShipment: {
        id: 'ship-existing-no-waybill',
        waybillNo: null, // 没有面单号
        status: 'INIT',
      },
    });

    await service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF');

    // 应走 updateMany 而非 create
    expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ship-existing-no-waybill',
        waybillNo: null,
      },
      data: expect.objectContaining({
        waybillNo: 'SF1234567890',
        carrierCode: 'SF',
        carrierName: '顺丰速运',
        sfOrderId: 'sf-order-abc-123',
      }),
    });
    expect(prisma.shipment.create).not.toHaveBeenCalled();
  });

  it('existingShipment 存在但 CAS updateMany count=0 时抛重复错误', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress, {
      existingShipment: {
        id: 'ship-existing-no-waybill',
        waybillNo: null,
        status: 'INIT',
      },
    });

    // CAS 失败：另一个并发请求已更新
    prisma.shipment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow('该订单已生成面单，请勿重复操作');
  });

  it('SHIPPED 状态订单也可生成面单', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress, { orderStatus: 'SHIPPED' });

    const result = await service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_SHIPPED, 'SF');

    expect(result.ok).toBe(true);
    expect(result.carrierCode).toBe('SF');
  });

  it('carrierCode 不区分大小写（传 sf 也能正常映射）', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);

    const result = await service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'sf');
    // carrierCode 被 toUpperCase 后仍能映射
    expect(result.carrierCode).toBe('SF');
    expect(result.carrierName).toBe('顺丰速运');
  });

  it('企业信息不存在时抛出 NotFoundException', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);
    prisma.company.findUnique.mockResolvedValue(null);

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow('企业信息不存在');
  });
});

/* ================================================================== */
/*  R2: 取消面单                                                       */
/* ================================================================== */

describe('cancelWaybill — 面单取消', () => {
  it('正常流程：先调顺丰取消，再清空本地 waybillNo/waybillUrl/sfOrderId', async () => {
    const { service, prisma, sfExpress } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue({
      id: 'ship-001',
      orderId: ORDER_PAID,
      companyId: COMPANY_ID,
      carrierCode: 'SF',
      waybillNo: 'SF1234567890',
      sfOrderId: 'sf-order-abc-123',
      status: 'INIT',
    });
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    sfExpress.cancelOrder.mockResolvedValue({ success: true });

    const result = await service.cancelWaybill(COMPANY_ID, ORDER_PAID);

    expect(result.ok).toBe(true);

    // 先调顺丰取消
    expect(sfExpress.cancelOrder).toHaveBeenCalledWith('sf-order-abc-123', 'SF1234567890');

    // 再清空本地
    expect(prisma.shipment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ship-001',
        status: 'INIT',
        waybillNo: 'SF1234567890',
      },
      data: {
        waybillNo: null,
        waybillUrl: null,
        trackingNo: null,
        sfOrderId: null,
      },
    });
  });

  it('未发货（INIT）才允许取消', async () => {
    const { service, prisma, sfExpress } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue({
      id: 'ship-001',
      carrierCode: 'SF',
      waybillNo: 'SF1234567890',
      sfOrderId: 'sf-order-abc-123',
      status: 'INIT',
    });
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });
    sfExpress.cancelOrder.mockResolvedValue({ success: true });

    const result = await service.cancelWaybill(COMPANY_ID, ORDER_PAID);
    expect(result.ok).toBe(true);
  });

  it('已发货（非 INIT）拒绝取消', async () => {
    const { service, prisma } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue({
      id: 'ship-001',
      carrierCode: 'SF',
      waybillNo: 'SF1234567890',
      status: 'IN_TRANSIT', // 非 INIT
    });

    await expect(
      service.cancelWaybill(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.cancelWaybill(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow('已发货的订单不可取消面单');
  });

  it('SHIPPED 状态拒绝取消', async () => {
    const { service, prisma } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue({
      id: 'ship-002',
      carrierCode: 'ZTO',
      waybillNo: 'ZTO8888888888',
      status: 'SHIPPED',
    });

    await expect(
      service.cancelWaybill(COMPANY_ID, ORDER_SHIPPED),
    ).rejects.toThrow('已发货的订单不可取消面单');
  });

  it('无面单拒绝取消', async () => {
    const { service, prisma } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue({
      id: 'ship-001',
      carrierCode: 'SF',
      waybillNo: null, // 无面单
      status: 'INIT',
    });

    await expect(
      service.cancelWaybill(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.cancelWaybill(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow('该订单未生成面单，无法取消');
  });

  it('物流记录不存在时抛出 NotFoundException', async () => {
    const { service, prisma } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue(null);

    await expect(
      service.cancelWaybill(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.cancelWaybill(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow('物流记录不存在');
  });

  it('远端取消失败仍然清空本地（best-effort）', async () => {
    const { service, prisma, sfExpress } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue({
      id: 'ship-001',
      carrierCode: 'SF',
      waybillNo: 'SF1234567890',
      sfOrderId: 'sf-order-abc-123',
      status: 'INIT',
    });
    prisma.shipment.updateMany.mockResolvedValue({ count: 1 });

    // 远端取消抛错
    sfExpress.cancelOrder.mockRejectedValue(new Error('远端网络错误'));

    // 但本地清空不应阻塞
    const result = await service.cancelWaybill(COMPANY_ID, ORDER_PAID);
    expect(result.ok).toBe(true);

    // 本地 updateMany 仍然被调用
    expect(prisma.shipment.updateMany).toHaveBeenCalled();
  });

  it('CAS 保护：并发取消只成功一次（updateMany count=0 → 抛错）', async () => {
    const { service, prisma, sfExpress } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue({
      id: 'ship-001',
      carrierCode: 'SF',
      waybillNo: 'SF1234567890',
      sfOrderId: 'sf-order-abc-123',
      status: 'INIT',
    });
    sfExpress.cancelOrder.mockResolvedValue({ success: true });

    // CAS 失败：另一个并发请求已清空面单
    prisma.shipment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.cancelWaybill(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.cancelWaybill(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow('该订单面单状态已变更，请刷新后重试');
  });
});

/* ================================================================== */
/*  R3: 面单打印链接与签名验证                                          */
/* ================================================================== */

describe('getWaybillPrintUrl / verifyPrintSignature — 打印链接', () => {
  it('生成带 HMAC 签名的临时 URL', () => {
    const { service } = createMocks();

    const url = service.getWaybillPrintUrl(COMPANY_ID, ORDER_PAID, STAFF_ID);

    expect(url).toContain('/api/v1/seller/orders/');
    expect(url).toContain(ORDER_PAID);
    expect(url).toContain('companyId=');
    expect(url).toContain('staffId=');
    expect(url).toContain('expires=');
    expect(url).toContain('sig=');
  });

  it('15分钟内签名有效', () => {
    const { service } = createMocks();

    const url = service.getWaybillPrintUrl(COMPANY_ID, ORDER_PAID, STAFF_ID);

    // 从 URL 中提取参数
    const urlObj = new URL(url, 'https://example.com');
    const expires = urlObj.searchParams.get('expires')!;
    const sig = urlObj.searchParams.get('sig')!;

    const isValid = service.verifyPrintSignature(
      COMPANY_ID,
      ORDER_PAID,
      STAFF_ID,
      expires,
      sig,
    );

    expect(isValid).toBe(true);
  });

  it('过期后签名无效', () => {
    const { service } = createMocks();

    // 构造一个已过期的时间戳（1小时前）
    const expiredTime = Date.now() - 60 * 60 * 1000;
    const payload = `${COMPANY_ID}:${ORDER_PAID}:${STAFF_ID}:${expiredTime}`;
    const { createHmac } = require('crypto');
    const sig = createHmac('sha256', 'test-seller-secret').update(payload).digest('hex');

    const isValid = service.verifyPrintSignature(
      COMPANY_ID,
      ORDER_PAID,
      STAFF_ID,
      String(expiredTime),
      sig,
    );

    expect(isValid).toBe(false);
  });

  it('篡改参数后签名无效', () => {
    const { service } = createMocks();

    const url = service.getWaybillPrintUrl(COMPANY_ID, ORDER_PAID, STAFF_ID);

    const urlObj = new URL(url, 'https://example.com');
    const expires = urlObj.searchParams.get('expires')!;
    const sig = urlObj.searchParams.get('sig')!;

    // 用不同的 orderId 验证 → 应该失败
    const isValid = service.verifyPrintSignature(
      COMPANY_ID,
      'o-tampered',
      STAFF_ID,
      expires,
      sig,
    );

    expect(isValid).toBe(false);
  });

  it('篡改 companyId 后签名无效', () => {
    const { service } = createMocks();

    const url = service.getWaybillPrintUrl(COMPANY_ID, ORDER_PAID, STAFF_ID);

    const urlObj = new URL(url, 'https://example.com');
    const expires = urlObj.searchParams.get('expires')!;
    const sig = urlObj.searchParams.get('sig')!;

    const isValid = service.verifyPrintSignature(
      COMPANY_C002, // 篡改企业 ID
      ORDER_PAID,
      STAFF_ID,
      expires,
      sig,
    );

    expect(isValid).toBe(false);
  });

  it('无效签名字符串返回 false', () => {
    const { service } = createMocks();

    const expires = String(Date.now() + 15 * 60 * 1000);
    // 全零签名
    const fakeSig = '0'.repeat(64);

    const isValid = service.verifyPrintSignature(
      COMPANY_ID,
      ORDER_PAID,
      STAFF_ID,
      expires,
      fakeSig,
    );

    expect(isValid).toBe(false);
  });
});

/* ================================================================== */
/*  R10: 多商家独立发货                                                 */
/* ================================================================== */

describe('多商家订单', () => {
  it('商家 A 生成面单不影响商家 B', async () => {
    const { service, prisma, sfExpress } = createMocks();

    // 商家 A (c-001) 的请求
    setupHappyPath(prisma, sfExpress, { companyId: COMPANY_ID });

    const resultA = await service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF');
    expect(resultA.ok).toBe(true);

    // 验证 orderItem 查询是按 companyId 过滤的
    expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: ORDER_PAID, companyId: COMPANY_ID },
      }),
    );

    // 验证 shipment 查询使用 orderId+companyId 组合键
    expect(prisma.shipment.findUnique).toHaveBeenCalledWith({
      where: {
        orderId_companyId: {
          orderId: ORDER_PAID,
          companyId: COMPANY_ID,
        },
      },
    });
  });

  it('orderId+companyId 唯一约束：不同商家可为同一订单各自生成面单', async () => {
    // 商家 A
    const mocksA = createMocks();
    setupHappyPath(mocksA.prisma, mocksA.sfExpress, { companyId: COMPANY_ID });

    const resultA = await mocksA.service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF');
    expect(resultA.ok).toBe(true);

    // 商家 B — 独立的 mock 实例
    const mocksB = createMocks();
    setupHappyPath(mocksB.prisma, mocksB.sfExpress, { companyId: COMPANY_C002 });

    const resultB = await mocksB.service.generateWaybill(COMPANY_C002, 'cs-002', ORDER_PAID, 'ZTO');
    expect(resultB.ok).toBe(true);

    // 确认 shipment.create 对两个商家分别调用了正确的 companyId
    expect(mocksA.prisma.shipment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: COMPANY_ID }),
    });
    expect(mocksB.prisma.shipment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: COMPANY_C002 }),
    });
  });

  it('assertCompanyCanAccessOrder 拒绝无关商家', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);

    // 所有 orderItem 都属于 c-002，但请求来自 c-001
    prisma.orderItem.findMany.mockResolvedValue([
      { companyId: COMPANY_C002, quantity: 1, sku: { product: { title: '青禾大米' } } },
      { companyId: COMPANY_C002, quantity: 2, sku: { product: { title: '有机蔬菜' } } },
    ]);

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('混合商品订单：企业只能看到自己的商品行', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);

    // orderItem 查询已经按 companyId 过滤（where: { orderId, companyId }）
    // 模拟只返回当前企业的商品
    prisma.orderItem.findMany.mockResolvedValue([
      { companyId: COMPANY_ID, quantity: 3, sku: { product: { title: '有机苹果' } } },
    ]);

    const result = await service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF');
    expect(result.ok).toBe(true);

    // 确认传给顺丰的货物名称只包含本企业商品
    expect(sfExpress.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        cargo: '有机苹果',
      }),
    );
  });
});

/* ================================================================== */
/*  R4: 批量操作                                                       */
/* ================================================================== */

describe('batchGenerateWaybill — 批量面单', () => {
  it('多个订单批量生成，全部成功', async () => {
    const { service, prisma, sfExpress, sellerRiskControl } = createMocks();
    setupHappyPath(prisma, sfExpress);

    const items = [
      { orderId: 'o-001', carrierCode: 'SF' },
      { orderId: 'o-002', carrierCode: 'ZTO' },
    ];

    const { results } = await service.batchGenerateWaybill(COMPANY_ID, STAFF_ID, items);

    expect(results).toHaveLength(2);
    expect(results[0].orderId).toBe('o-001');
    expect(results[0].success).toBe(true);
    expect(results[1].orderId).toBe('o-002');
    expect(results[1].success).toBe(true);

    // 风控检查被调用
    expect(sellerRiskControl.assertFeatureAllowed).toHaveBeenCalledWith(
      COMPANY_ID,
      'BATCH_WAYBILL',
    );
  });

  it('部分失败不阻断后续订单', async () => {
    const { service, prisma, sfExpress } = createMocks();

    // 第一个订单找不到
    let callCount = 0;
    prisma.order.findUnique.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return null; // 第一个订单不存在
      return { id: 'o-002', status: 'PAID', addressSnapshot: ADDRESS_SNAPSHOT };
    });

    prisma.orderItem.findMany.mockResolvedValue([
      { companyId: COMPANY_ID, quantity: 1, sku: { product: { title: '苹果' } } },
    ]);
    prisma.shipment.findUnique.mockResolvedValue(null);
    prisma.shipment.create.mockResolvedValue({ id: 'ship-new' });
    prisma.company.findUnique.mockResolvedValue(COMPANY_INFO);
    sfExpress.createOrder.mockResolvedValue({
      waybillNo: 'ZTO5555555555',
      sfOrderId: 'sf-order-def-456',
    });

    const items = [
      { orderId: 'o-not-found', carrierCode: 'SF' },
      { orderId: 'o-002', carrierCode: 'ZTO' },
    ];

    const { results } = await service.batchGenerateWaybill(COMPANY_ID, STAFF_ID, items);

    expect(results).toHaveLength(2);
    // 第一个失败
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('订单不存在');
    // 第二个仍然成功
    expect(results[1].success).toBe(true);
    expect(results[1].waybillNo).toBeDefined();
  });

  it('风险控制检查（assertFeatureAllowed）被拒绝时阻断整个批次', async () => {
    const { service, sellerRiskControl } = createMocks();

    sellerRiskControl.assertFeatureAllowed.mockRejectedValue(
      new ForbiddenException('企业信用分不足，无法使用批量面单'),
    );

    await expect(
      service.batchGenerateWaybill(COMPANY_ID, STAFF_ID, [
        { orderId: 'o-001', carrierCode: 'SF' },
      ]),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.batchGenerateWaybill(COMPANY_ID, STAFF_ID, [
        { orderId: 'o-001', carrierCode: 'SF' },
      ]),
    ).rejects.toThrow('企业信用分不足，无法使用批量面单');
  });

  it('空数组时直接返回空结果（不报错）', async () => {
    const { service, sellerRiskControl } = createMocks();

    const { results } = await service.batchGenerateWaybill(COMPANY_ID, STAFF_ID, []);

    expect(results).toHaveLength(0);
    expect(sellerRiskControl.assertFeatureAllowed).toHaveBeenCalled();
  });
});

/* ================================================================== */
/*  面单打印数据获取                                                    */
/* ================================================================== */

describe('getWaybillPrintData — 获取打印数据', () => {
  it('正常返回面单打印信息', async () => {
    const { service, prisma } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue({
      id: 'ship-001',
      waybillNo: 'SF1234567890',
      waybillUrl: 'data:application/pdf;base64,test-pdf',
      carrierCode: 'SF',
      carrierName: '顺丰速运',
    });

    const data = await service.getWaybillPrintData(COMPANY_ID, ORDER_PAID);

    expect(data.waybillNo).toBe('SF1234567890');
    expect(data.carrierCode).toBe('SF');
    expect(data.carrierName).toBe('顺丰速运');
  });

  it('物流记录不存在时抛出 NotFoundException', async () => {
    const { service, prisma } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue(null);

    await expect(
      service.getWaybillPrintData(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.getWaybillPrintData(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow('物流记录不存在');
  });

  it('面单未生成时抛出 NotFoundException', async () => {
    const { service, prisma } = createMocks();

    prisma.shipment.findUnique.mockResolvedValue({
      id: 'ship-001',
      waybillNo: null,
      waybillUrl: null,
      carrierCode: 'SF',
      carrierName: '顺丰速运',
    });

    await expect(
      service.getWaybillPrintData(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.getWaybillPrintData(COMPANY_ID, ORDER_PAID),
    ).rejects.toThrow('该订单未生成电子面单');
  });
});

/* ================================================================== */
/*  审计日志                                                            */
/* ================================================================== */

describe('recordWaybillPrintAccess — 打印审计日志', () => {
  it('正常记录审计日志', async () => {
    const { service, prisma } = createMocks();
    prisma.sellerAuditLog.create.mockResolvedValue({});

    await service.recordWaybillPrintAccess(
      COMPANY_ID,
      STAFF_ID,
      ORDER_PAID,
      '192.168.1.100',
      'Mozilla/5.0',
    );

    expect(prisma.sellerAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        staffId: STAFF_ID,
        companyId: COMPANY_ID,
        action: 'PRINT_WAYBILL',
        module: 'shipping',
        targetType: 'Order',
        targetId: ORDER_PAID,
        userAgent: 'Mozilla/5.0',
      }),
    });
  });

  it('审计日志写入失败不抛异常（静默失败）', async () => {
    const { service, prisma } = createMocks();
    prisma.sellerAuditLog.create.mockRejectedValue(new Error('DB error'));

    // 不应抛错
    await expect(
      service.recordWaybillPrintAccess(COMPANY_ID, STAFF_ID, ORDER_PAID),
    ).resolves.toBeUndefined();
  });
});

/* ================================================================== */
/*  createCarrierWaybill — 快递面单创建                                 */
/* ================================================================== */

describe('createCarrierWaybill — 快递面单创建', () => {
  it('正确组装发件人和收件人信息传给顺丰', async () => {
    const { service, prisma, sfExpress } = createMocks();

    prisma.company.findUnique.mockResolvedValue(COMPANY_INFO);
    sfExpress.createOrder.mockResolvedValue({
      waybillNo: 'SF1234567890',
      sfOrderId: 'sf-order-abc-123',
    });

    await service.createCarrierWaybill(
      COMPANY_ID,
      'SF',
      ADDRESS_SNAPSHOT,
      [{ name: '有机苹果', quantity: 2 }],
    );

    expect(sfExpress.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        cargo: '有机苹果',
      }),
    );
  });

  it('多商品货物名称以逗号拼接', async () => {
    const { service, prisma, sfExpress } = createMocks();

    prisma.company.findUnique.mockResolvedValue(COMPANY_INFO);
    sfExpress.createOrder.mockResolvedValue({
      waybillNo: 'ZTO8888888888',
      sfOrderId: 'sf-order-xyz',
    });

    await service.createCarrierWaybill(
      COMPANY_ID,
      'ZTO',
      ADDRESS_SNAPSHOT,
      [
        { name: '有机苹果', quantity: 2 },
        { name: '云南普洱茶', quantity: 1 },
      ],
    );

    expect(sfExpress.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        cargo: '有机苹果, 云南普洱茶',
      }),
    );
  });

  it('返回结果包含 carrierName 和 senderInfoSnapshot / receiverInfoSnapshot', async () => {
    const { service, prisma, sfExpress } = createMocks();

    prisma.company.findUnique.mockResolvedValue(COMPANY_INFO);
    sfExpress.createOrder.mockResolvedValue({
      waybillNo: 'SF1234567890',
      sfOrderId: 'sf-order-abc',
    });

    const result = await service.createCarrierWaybill(
      COMPANY_ID,
      'SF',
      ADDRESS_SNAPSHOT,
      [{ name: '苹果', quantity: 1 }],
    );

    expect(result.carrierCode).toBe('SF');
    expect(result.carrierName).toBe('顺丰速运');
    expect(result.waybillNo).toBe('SF1234567890');
    expect(result.senderInfoSnapshot).toEqual(expect.objectContaining({
      senderName: '张经理',
      senderPhone: '13800001001',
    }));
    expect(result.receiverInfoSnapshot).toEqual(expect.objectContaining({
      name: '林青禾',
      phone: '13800138000',
    }));
  });
});

/* ================================================================== */
/*  cancelCarrierWaybill — 远端面单取消                                 */
/* ================================================================== */

describe('cancelCarrierWaybill — 远端面单取消', () => {
  it('调用顺丰取消接口', async () => {
    const { service, sfExpress } = createMocks();
    sfExpress.cancelOrder.mockResolvedValue({ success: true });

    await service.cancelCarrierWaybill('sf-order-abc-123', 'SF1234567890');

    expect(sfExpress.cancelOrder).toHaveBeenCalledWith('sf-order-abc-123', 'SF1234567890');
  });

  it('缺少 sfOrderId 和 waybillNo 时跳过', async () => {
    const { service, sfExpress } = createMocks();

    await service.cancelCarrierWaybill('', '');

    expect(sfExpress.cancelOrder).not.toHaveBeenCalled();
  });

  it('远端取消失败时不抛异常（静默警告）', async () => {
    const { service, sfExpress } = createMocks();
    sfExpress.cancelOrder.mockRejectedValue(new Error('网络超时'));

    await expect(
      service.cancelCarrierWaybill('sf-order-abc-123', 'SF1234567890'),
    ).resolves.toBeUndefined();
  });
});

/* ================================================================== */
/*  parseAddressSnapshot — 地址解析边界情况                              */
/* ================================================================== */

describe('parseAddressSnapshot — 地址解析', () => {
  it('addressSnapshot 为 null 时抛出 BadRequestException', async () => {
    const { service, prisma, sfExpress } = createMocks();
    setupHappyPath(prisma, sfExpress);

    // order 的 addressSnapshot 为 null
    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_PAID,
      status: 'PAID',
      addressSnapshot: null,
    });

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.generateWaybill(COMPANY_ID, STAFF_ID, ORDER_PAID, 'SF'),
    ).rejects.toThrow('订单地址信息缺失');
  });
});
