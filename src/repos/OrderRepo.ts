/**
 * 订单仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/orders.ts` 初始化 `orderStore`，并在内存中模拟下单/支付/售后流转
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口（F1 新流程）：
 * - `POST /api/v1/orders/checkout` → 创建 CheckoutSession（F1 新入口）
 * - `GET  /api/v1/orders/checkout/{sessionId}/status` → 查询会话状态
 * - `POST /api/v1/orders/checkout/{sessionId}/cancel` → 取消会话
 * - `POST /api/v1/payments/callback` → 支付回调（开发环境模拟支付）
 * - `POST /api/v1/orders/preview` → 预结算
 * - `GET  /api/v1/orders?status=&page=&pageSize=` → 订单列表
 * - `GET  /api/v1/orders/status-counts` → 状态角标统计
 * - `GET  /api/v1/orders/latest-issue` → 最近异常订单
 * - `GET  /api/v1/orders/{id}` → 订单详情
 * - `POST /api/v1/orders/{id}/receive` → 确认收货
 * - `POST /api/v1/orders/{id}/cancel` → 取消订单
 * - `POST /api/v1/replacements/orders/{orderId}` → 申请换货
 *
 * 已废弃接口（后端返回 410 Gone）：
 * - `POST /api/v1/orders` → 旧下单（改用 checkout）
 * - `POST /api/v1/orders/{id}/pay` → 旧支付（改用 CheckoutSession + 支付回调）
 * - `POST /api/v1/orders/batch-pay` → 旧合并支付（改用 checkout）
 */
import { mockOrders } from '../mocks';
import { Order, OrderItem, OrderStatus, PaginationResult, PaymentMethod, ShipmentDetail, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';
import { normalizePagination } from './http/pagination';

let orderStore = [...mockOrders];

const buildOrderTotal = (items: OrderItem[]) =>
  items.reduce((sum, item) => sum + item.price * item.quantity, 0);

const buildAfterSaleTimeline = (
  status: NonNullable<Order['afterSaleStatus']>
): NonNullable<Order['afterSaleTimeline']> => {
  if (!status) {
    return [];
  }
  const timeline: NonNullable<Order['afterSaleTimeline']> = [];
  const push = (value: NonNullable<Order['afterSaleStatus']>, title: string) => {
    timeline.push({ status: value, title, time: new Date().toISOString().slice(0, 16).replace('T', ' ') });
  };

  push('applying', '提交申请');
  if (status !== 'applying') {
    push('reviewing', '平台审核');
  }
  if (status === 'approved' || status === 'shipped' || status === 'completed') {
    push('approved', '审核通过');
  }
  if (status === 'shipped' || status === 'completed') {
    push('shipped', '卖家重新发货');
  }
  if (status === 'refunding' || status === 'failed') {
    push('refunding', '退款处理中');
  }
  if (status === 'completed') {
    push('completed', '售后完成');
  }
  if (status === 'rejected') {
    push('rejected', '审核驳回');
  }
  if (status === 'failed') {
    push('failed', '处理失败');
  }
  return timeline;
};

/** N09修复：预结算返回类型 */
export interface PreviewOrderGroup {
  companyId: string;
  companyName: string;
  items: { skuId: string; title: string; image: string; unitPrice: number; quantity: number }[];
  goodsAmount: number;
  shippingFee: number;
  discountAmount: number;
}

export interface PreviewOrderResult {
  groups: PreviewOrderGroup[];
  summary: {
    totalGoodsAmount: number;
    totalShippingFee: number;
    totalDiscount: number;
    vipDiscount: number;
    totalPayable: number;
    freeShippingThreshold?: number;   // 当前用户适用的免运费门槛
    amountToFreeShipping?: number;    // 还差多少免运费（0=已免运费）
  };
}

/** F1: CheckoutSession 响应类型 */
export interface CheckoutSessionResult {
  sessionId: string;
  merchantOrderNo: string;
  expectedTotal: number;
  goodsAmount: number;
  shippingFee: number;
  discountAmount: number;
  vipDiscountAmount?: number;
  paymentParams?: Record<string, unknown>;
}

/** F1: CheckoutSession 状态 */
export interface CheckoutSessionStatus {
  status: 'ACTIVE' | 'PAID' | 'COMPLETED' | 'EXPIRED' | 'FAILED';
  sessionId?: string;
  orderIds?: string[];
  orderId?: string;
  expectedTotal?: number;
}

export interface PaymentCallbackResult {
  code: string;
  message: string;
  orderIds?: string[];
}

/** 换货申请结果（后端 `POST /replacements/orders/:orderId`） */
export interface AfterSaleApplication {
  id: string;
  orderId: string;
  orderItemId?: string;
  reasonType: 'QUALITY_ISSUE' | 'WRONG_ITEM' | 'DAMAGED' | 'NOT_AS_DESCRIBED' | 'SIZE_ISSUE' | 'EXPIRED' | 'OTHER';
  reason: string;
  photos: string[];
  status: 'REQUESTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SHIPPED' | 'COMPLETED';
  createdAt: string;
  updatedAt: string;
}

const AFTER_SALE_REASON_LABELS: Record<AfterSaleApplication['reasonType'], string> = {
  QUALITY_ISSUE: '质量问题',
  WRONG_ITEM: '发错商品',
  DAMAGED: '运输损坏',
  NOT_AS_DESCRIBED: '与描述不符',
  SIZE_ISSUE: '规格不符',
  EXPIRED: '临期/过期',
  OTHER: '其他',
};

// 订单仓储：订单列表与详情
export const OrderRepo = {
  /**
   * F1: 创建结算会话
   * - 后端接口：`POST /api/v1/orders/checkout`
   * - 返回 sessionId + merchantOrderNo + 支付参数
   */
  createCheckoutSession: async (payload: {
    items: { skuId: string; quantity: number; cartItemId?: string }[];
    addressId: string;
    couponInstanceIds?: string[];
    paymentChannel?: string;
    idempotencyKey?: string;
    expectedTotal?: number;
  }): Promise<Result<CheckoutSessionResult>> => {
    if (USE_MOCK) {
      return simulateRequest({
        sessionId: `cs-${Date.now()}`,
        merchantOrderNo: `MO-${Date.now()}`,
        expectedTotal: 100,
        goodsAmount: 92,
        shippingFee: 8,
        discountAmount: 0,
      }, { delay: 300 });
    }
    return ApiClient.post<CheckoutSessionResult>('/orders/checkout', payload);
  },

  /**
   * VIP 礼包结算（Phase 3）
   * - 后端接口：`POST /api/v1/orders/vip-checkout`
   * - 独立于普通商品 checkout，无购物车
   */
  createVipCheckoutSession: async (payload: {
    packageId: string;
    giftOptionId: string;
    addressId: string;
    paymentChannel?: string;
    idempotencyKey?: string;
    expectedTotal?: number;
  }): Promise<Result<CheckoutSessionResult>> => {
    if (USE_MOCK) {
      return simulateRequest({
        sessionId: `cs-vip-${Date.now()}`,
        merchantOrderNo: `VIP-${Date.now()}`,
        expectedTotal: payload.expectedTotal ?? 399,
        goodsAmount: payload.expectedTotal ?? 399,
        shippingFee: 0,
        discountAmount: 0,
      }, { delay: 300 });
    }
    return ApiClient.post<CheckoutSessionResult>('/orders/vip-checkout', payload);
  },

  /**
   * F1: 查询结算会话状态（前端轮询）
   * - 后端接口：`GET /api/v1/orders/checkout/{sessionId}/status`
   */
  getCheckoutSessionStatus: async (sessionId: string): Promise<Result<CheckoutSessionStatus>> => {
    if (USE_MOCK) {
      return simulateRequest({
        sessionId,
        status: 'COMPLETED' as const,
        orderIds: [`o-${Date.now()}`],
        expectedTotal: 100,
      }, { delay: 200 });
    }
    return ApiClient.get<CheckoutSessionStatus>(`/orders/checkout/${sessionId}/status`);
  },

  /**
   * P5 第三轮：App 端主动查询支付宝订单状态（不等 notify 异步通知）
   * - 后端接口：`POST /api/v1/orders/checkout/{sessionId}/active-query`
   * - App 调起支付宝 SDK 返回后立刻调用，让后端去支付宝主动查询真实状态
   * - 如果支付宝已 TRADE_SUCCESS → 立即建单 + 返回 COMPLETED + orderIds
   * - 如果还在 WAIT_BUYER_PAY / 中间态 → 返回当前 session 状态，让前端 polling 兜底
   * - 解决沙箱 notify 慢/丢失导致的"已扣款但订单未生成"问题
   *
   * 返回 confirmedBy 字段说明状态来源：
   * - 'already-completed' / 'terminal-state' / 'no-merchant-order-no'
   * - 'query-error' / 'not-found' / `alipay-${tradeStatus.toLowerCase()}`
   * - 'active-query-success'（关键：成功建单，前端可直接跳成功页停止 polling）
   */
  activeQueryPayment: async (
    sessionId: string,
  ): Promise<
    Result<
      CheckoutSessionStatus & {
        confirmedBy: string;
      }
    >
  > => {
    if (USE_MOCK) {
      return simulateRequest(
        {
          sessionId,
          status: 'COMPLETED' as const,
          orderIds: [`o-${Date.now()}`],
          expectedTotal: 100,
          confirmedBy: 'active-query-success',
        },
        { delay: 200 },
      );
    }
    return ApiClient.post<CheckoutSessionStatus & { confirmedBy: string }>(
      `/orders/checkout/${sessionId}/active-query`,
    );
  },

  /**
   * F1: 取消结算会话（释放红包锁定）
   * - 后端接口：`POST /api/v1/orders/checkout/{sessionId}/cancel`
   */
  cancelCheckoutSession: async (sessionId: string): Promise<Result<{ success: boolean }>> => {
    if (USE_MOCK) {
      return simulateRequest({ success: true });
    }
    return ApiClient.post<{ success: boolean }>(`/orders/checkout/${sessionId}/cancel`);
  },

  /**
   * F1: 模拟支付回调（开发环境）
   * - 后端接口：`POST /api/v1/payments/callback`
   * - 生产环境由支付网关调用
   */
  simulatePayment: async (merchantOrderNo: string): Promise<Result<PaymentCallbackResult>> => {
    if (USE_MOCK) {
      return simulateRequest({ code: 'SUCCESS', message: 'mock' }, { delay: 500 });
    }
    return ApiClient.post<PaymentCallbackResult>('/payments/callback', {
      merchantOrderNo,
      providerTxnId: `DEV-${Date.now()}`,
      status: 'SUCCESS',
    });
  },

  /**
   * N09修复：预结算 — 获取服务端计算的分组、运费、红包、合计
   * - 用途：结算页展示准确的价格明细
   * - 后端接口：`POST /api/v1/orders/preview`
   */
  previewOrder: async (payload: {
    items: OrderItem[];
    addressId?: string;
    couponInstanceIds?: string[];
  }): Promise<Result<PreviewOrderResult>> => {
    if (USE_MOCK) {
      // Mock 模式：按 companyId 分组模拟
      const items = payload.items;
      const goodsAmount = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const shippingFee = goodsAmount >= 99 ? 0 : 8;
      return simulateRequest({
        groups: [{
          companyId: 'mock-company',
          companyName: '爱买买自营',
          items: items.map((i) => ({ skuId: i.skuId || i.productId, title: i.title, image: i.image, unitPrice: i.price, quantity: i.quantity })),
          goodsAmount,
          shippingFee,
          discountAmount: 0,
        }],
        summary: {
          totalGoodsAmount: goodsAmount,
          totalShippingFee: shippingFee,
          totalDiscount: 0,
          vipDiscount: 0,
          totalPayable: goodsAmount + shippingFee,
          freeShippingThreshold: 99,
          amountToFreeShipping: Math.max(0, 99 - goodsAmount),
        },
      });
    }

    return ApiClient.post<PreviewOrderResult>('/orders/preview', {
      items: payload.items.map((item) => ({
        skuId: item.skuId || item.productId,
        quantity: item.quantity,
      })),
      addressId: payload.addressId,
      couponInstanceIds: payload.couponInstanceIds,
    });
  },
  /**
   * 订单列表（可按状态筛选，支持分页）
   * - 用途：订单列表页
   * - 后端接口：`GET /api/v1/orders?status=&page=&pageSize=`
   * - 响应：`Result<PaginationResult<Order>>`
   */
  list: async (status?: OrderStatus, options?: { page?: number; pageSize?: number }): Promise<Result<PaginationResult<Order>>> => {
    if (USE_MOCK) {
      // 订单列表：支持按状态筛选，Mock 模式返回全量数据（无分页）
      const orders = status ? orderStore.filter((order) => order.status === status) : orderStore;
      return simulateRequest({ items: orders, total: orders.length, page: 1, pageSize: orders.length });
    }

    // 后端返回分页格式 { items, total, page, pageSize }，通过 normalizePagination 转换
    const r = await ApiClient.get<{ items: Order[]; total: number; page: number; pageSize: number }>('/orders', {
      status,
      page: options?.page ?? 1,
      pageSize: options?.pageSize ?? 20,
    });
    if (!r.ok) return r;
    return { ok: true as const, data: normalizePagination(r.data) };
  },
  /**
   * 订单状态角标统计
   * - 用途：我的页"待付款/待发货/待收货/退款售后"角标
   * - 后端接口：`GET /api/v1/orders/status-counts`
   */
  getStatusCounts: async (): Promise<Result<Record<OrderStatus, number>>> => {
    if (USE_MOCK) {
      // 订单状态角标统计（复杂业务逻辑需中文注释）
      const counts: Record<OrderStatus, number> = {
        pendingPay: 0,
        pendingShip: 0,
        shipping: 0,
        delivered: 0,
        afterSale: 0,
        completed: 0,
        canceled: 0,
      };
      orderStore.forEach((order) => {
        counts[order.status] = (counts[order.status] ?? 0) + 1;
      });
      return simulateRequest(counts);
    }

    return ApiClient.get<Record<OrderStatus, number>>('/orders/status-counts');
  },
  /**
   * 最近异常订单
   * - 用途：我的页"智能售后入口"直达问题订单
   * - 后端接口：`GET /api/v1/orders/latest-issue`
   */
  getLatestIssue: async (): Promise<Result<Order | null>> => {
    if (USE_MOCK) {
      // 最近异常订单：用于售后入口直达（复杂业务逻辑需中文注释）
      const issue = orderStore.find((order) => order.issueFlag || order.status === 'afterSale') ?? null;
      return simulateRequest(issue);
    }

    return ApiClient.get<Order | null>('/orders/latest-issue');
  },
  /**
   * 订单详情
   * - 用途：订单详情页
   * - 后端接口：`GET /api/v1/orders/{id}`
   */
  getById: async (id: string): Promise<Result<Order>> => {
    if (USE_MOCK) {
      const order = orderStore.find((item) => item.id === id);
      if (!order) {
        return err(createAppError('NOT_FOUND', `订单不存在: ${id}`, '订单未找到'));
      }
      return simulateRequest(order);
    }

    return ApiClient.get<Order>(`/orders/${id}`);
  },
  /**
   * @deprecated F1 已停用 — 后端 POST /orders 已返回 410 Gone
   * 保留仅用于旧代码兼容，新流程请使用 createCheckoutSession
   *
   * 下单（从购物车生成订单）
   * - 后端接口：`POST /api/v1/orders`（已废弃）
   */
  createFromCart: async (payload: {
    items: OrderItem[];
    paymentMethod: PaymentMethod;
    addressId?: string;
    /** 选中的红包 ID */
    redPackId?: string;
    /** 红包抵扣金额 */
    redPackAmount?: number;
    /** 幂等键，防止网络重试导致重复订单 */
    idempotencyKey?: string;
    /** S12修复：前端 preview 时看到的总金额，后端校验一致性 */
    expectedTotal?: number;
  }): Promise<Result<Order>> => {
    if (USE_MOCK) {
      if (payload.items.length === 0) {
        return err(createAppError('INVALID', '购物车为空', '请先添加商品'));
      }
      const subtotal = buildOrderTotal(payload.items);
      // N02修复：Mock 运费计入总价，与后端逻辑一致
      const shippingFee = subtotal >= 99 ? 0 : 8;
      const discountAmount = payload.redPackAmount ?? 0;
      const newOrder: Order = {
        id: `o-${Date.now()}`,
        status: 'pendingPay',
        totalPrice: Math.max(0, subtotal + shippingFee - discountAmount),
        discountAmount: discountAmount > 0 ? discountAmount : undefined,
        createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        items: payload.items,
        paymentMethod: payload.paymentMethod,
      };
      orderStore = [newOrder, ...orderStore];
      return simulateRequest(newOrder, { delay: 260 });
    }

    return ApiClient.post<Order>('/orders', {
      items: payload.items.map((item) => {
        const skuId = item.skuId || item.productId;
        if (!skuId) {
          throw new Error('订单项缺少 skuId');
        }
        return { skuId, quantity: item.quantity };
      }),
      addressId: payload.addressId,
      redPackId: payload.redPackId,
      idempotencyKey: payload.idempotencyKey,
      expectedTotal: payload.expectedTotal,
    });
  },
  /**
   * @deprecated F1 已停用 — 后端 POST /orders/:id/pay 已返回 410 Gone
   * 保留仅用于 Mock 模式模拟旧订单支付，真实环境通过 CheckoutSession 支付
   *
   * 支付订单
   * - 后端接口：`POST /api/v1/orders/{id}/pay`（已废弃）
   */
  payOrder: async (orderId: string, paymentMethod: PaymentMethod): Promise<Result<Order>> => {
    if (USE_MOCK) {
      const order = orderStore.find((item) => item.id === orderId);
      if (!order) {
        return err(createAppError('NOT_FOUND', `订单不存在: ${orderId}`, '订单未找到'));
      }
      if (order.status !== 'pendingPay') {
        return err(createAppError('INVALID', '订单状态不可支付', '当前无法支付'));
      }
      order.status = 'pendingShip';
      order.paymentMethod = paymentMethod;
      return simulateRequest(order, { delay: 240 });
    }

    return ApiClient.post<Order>(`/orders/${orderId}/pay`, { paymentMethod });
  },

  /**
   * @deprecated F1 已停用 — 后端 POST /orders/batch-pay 已返回 410 Gone
   * 保留仅用于 Mock 模式兼容，真实环境通过 CheckoutSession 支付
   *
   * N16修复：合并支付（拆单后一次支付多个订单）
   * - 后端接口：`POST /api/v1/orders/batch-pay`（已废弃）
   */
  batchPayOrders: async (orderIds: string[], paymentMethod: PaymentMethod): Promise<Result<{ success: boolean; orderIds: string[] }>> => {
    if (USE_MOCK) {
      // Mock 模式：逐个标记为已支付
      for (const oid of orderIds) {
        const order = orderStore.find((item) => item.id === oid);
        if (order && order.status === 'pendingPay') {
          order.status = 'pendingShip';
          order.paymentMethod = paymentMethod;
        }
      }
      return simulateRequest({ success: true, orderIds }, { delay: 300 });
    }
    return ApiClient.post<{ success: boolean; orderIds: string[] }>('/orders/batch-pay', { orderIds, paymentMethod });
  },

  /**
   * 申请换货
   * - 用途：订单详情 -> 申请换货
   * - 后端接口：`POST /api/v1/replacements/orders/{orderId}`
   * - body：`{ reason, photos, orderItemId? }`
   */
  applyAfterSale: async (payload: {
    orderId: string;
    reasonType: AfterSaleApplication['reasonType'];
    reason?: string;
    photos: string[];
    /** 单个订单项 ID（不传 = 整单换货） */
    orderItemId?: string;
  }): Promise<Result<AfterSaleApplication>> => {
    if (USE_MOCK) {
      const order = orderStore.find((item) => item.id === payload.orderId);
      if (!order) {
        return err(createAppError('NOT_FOUND', `订单不存在: ${payload.orderId}`, '订单未找到'));
      }
      if (order.afterSaleStatus) {
        return err(createAppError('INVALID', '售后已申请', '请勿重复提交'));
      }
      order.status = 'afterSale';
      order.issueFlag = true;
      order.afterSaleStatus = 'applying';
      order.afterSaleReason = payload.reasonType === 'OTHER'
        ? (payload.reason || AFTER_SALE_REASON_LABELS.OTHER)
        : AFTER_SALE_REASON_LABELS[payload.reasonType];
      order.afterSaleTimeline = buildAfterSaleTimeline('applying');
      return simulateRequest({
        id: `rep-${Date.now()}`,
        orderId: payload.orderId,
        orderItemId: payload.orderItemId,
        reasonType: payload.reasonType,
        reason: payload.reasonType === 'OTHER'
          ? (payload.reason || AFTER_SALE_REASON_LABELS.OTHER)
          : AFTER_SALE_REASON_LABELS[payload.reasonType],
        photos: payload.photos,
        status: 'REQUESTED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { delay: 260 });
    }

    return ApiClient.post<AfterSaleApplication>(`/replacements/orders/${payload.orderId}`, {
      reasonType: payload.reasonType,
      reason: payload.reason,
      photos: payload.photos,
      orderItemId: payload.orderItemId,
    });
  },
  /**
   * 确认收货
   * - 用途：订单详情 -> 确认收货
   * - 后端接口：`POST /api/v1/orders/{id}/receive`
   */
  confirmReceive: async (orderId: string): Promise<Result<Order>> => {
    if (USE_MOCK) {
      const order = orderStore.find((item) => item.id === orderId);
      if (!order) {
        return err(createAppError('NOT_FOUND', `订单不存在: ${orderId}`, '订单未找到'));
      }
      if (order.status !== 'shipping') {
        return err(createAppError('INVALID', '订单状态不可确认收货', '当前无法确认收货'));
      }
      order.status = 'completed';
      return simulateRequest(order, { delay: 240 });
    }

    return ApiClient.post<Order>(`/orders/${orderId}/receive`);
  },
  /**
   * 确认收到换货商品
   * - 用途：售后处理中（卖家已补发）后，买家确认换货完成
   * - 后端接口：`POST /api/v1/orders/{id}/replacement/confirm`
   */
  confirmReplacement: async (orderId: string): Promise<Result<AfterSaleApplication>> => {
    if (USE_MOCK) {
      const order = orderStore.find((item) => item.id === orderId);
      if (!order) {
        return err(createAppError('NOT_FOUND', `订单不存在: ${orderId}`, '订单未找到'));
      }
      if (order.afterSaleStatus !== 'shipped') {
        return err(createAppError('INVALID', '当前无可确认的换货记录', '请等待卖家补发后再确认'));
      }
      order.afterSaleStatus = 'completed';
      order.afterSaleTimeline = buildAfterSaleTimeline('completed');
      return simulateRequest({
        id: `rep-${Date.now()}`,
        orderId,
        reasonType: 'OTHER',
        reason: order.afterSaleReason || '换货确认',
        photos: [],
        status: 'COMPLETED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { delay: 220 });
    }

    return ApiClient.post<AfterSaleApplication>(`/orders/${orderId}/replacement/confirm`);
  },
  /**
   * 取消订单
   * - 用途：订单详情 -> 取消订单
   * - 后端接口：`POST /api/v1/orders/{id}/cancel`
   */
  cancelOrder: async (orderId: string): Promise<Result<Order>> => {
    if (USE_MOCK) {
      const order = orderStore.find((item) => item.id === orderId);
      if (!order) {
        return err(createAppError('NOT_FOUND', `订单不存在: ${orderId}`, '订单未找到'));
      }
      if (order.status !== 'pendingPay') {
        return err(createAppError('INVALID', '仅待付款订单可取消', '当前无法取消'));
      }
      orderStore = orderStore.filter((item) => item.id !== orderId);
      return simulateRequest(order, { delay: 240 });
    }

    return ApiClient.post<Order>(`/orders/${orderId}/cancel`);
  },
  /**
   * 主动查询快递100物流轨迹并更新本地数据
   * - 用途：下拉刷新时主动查询最新物流信息
   * - 后端接口：`GET /api/v1/shipments/{orderId}/track`
   */
  refreshShipmentTracking: async (orderId: string): Promise<Result<ShipmentDetail | null>> => {
    if (USE_MOCK) {
      // Mock 模式复用 getShipment 逻辑
      return OrderRepo.getShipment(orderId);
    }
    return ApiClient.get<ShipmentDetail | null>(`/shipments/${orderId}/track`);
  },
  /**
   * 查询物流详情
   * - 用途：订单详情页物流追踪
   * - 后端接口：`GET /api/v1/shipments/{orderId}`
   */
  getShipment: async (orderId: string): Promise<Result<ShipmentDetail | null>> => {
    if (USE_MOCK) {
      // Mock 模式返回模拟物流数据
      const order = orderStore.find((item) => item.id === orderId);
      if (!order || (order.status !== 'shipping' && order.status !== 'delivered' && order.status !== 'completed')) {
        return simulateRequest(null);
      }
      return simulateRequest({
        id: `ship-${orderId}`,
        carrierCode: 'SF',
        carrierName: '顺丰速运',
        trackingNo: `SF${Date.now().toString().slice(-10)}`,
        status: order.status === 'shipping' ? 'IN_TRANSIT' : 'DELIVERED',
        shippedAt: order.createdAt,
        deliveredAt: order.status === 'completed' ? order.createdAt : null,
        events: [
          { id: 'e-1', occurredAt: order.createdAt, message: '快递已揽收', location: '上海市浦东新区' },
          { id: 'e-2', occurredAt: order.createdAt, message: '运输中', location: '上海转运中心' },
        ],
      }, { delay: 300 });
    }

    return ApiClient.get<ShipmentDetail | null>(`/shipments/${orderId}`);
  },
  // 推进售后流程：用于前端模拟审核/退款（保持 mock-only）
  /**
   * 推进售后流程（仅前端模拟/测试）
   * - 真实后端：应由运营审核/退款回调/定时任务推进状态机
   * - 建议：不要对 C 端开放该接口；可仅在管理端/测试环境开放
   */
  advanceAfterSale: async (orderId: string): Promise<Result<Order>> => {
    if (!USE_MOCK) {
      return err(createAppError('INVALID', '模拟接口仅在 Mock 模式可用', '当前环境不支持此操作'));
    }
    const order = orderStore.find((item) => item.id === orderId);
    if (!order) {
      return err(createAppError('NOT_FOUND', `订单不存在: ${orderId}`, '订单未找到'));
    }
    if (!order.afterSaleStatus) {
      return err(createAppError('INVALID', '暂无售后申请', '请先提交售后'));
    }
    const nextMap: Record<
      NonNullable<Order['afterSaleStatus']>,
      NonNullable<Order['afterSaleStatus']>
    > = {
      applying: 'reviewing',
      reviewing: 'approved',
      approved: 'shipped',
      shipped: 'completed',
      refunding: 'completed',
      completed: 'completed',
      rejected: 'rejected',
      failed: 'failed',
    };
    const nextStatus = nextMap[order.afterSaleStatus];
    order.afterSaleStatus = nextStatus;
    order.afterSaleTimeline = buildAfterSaleTimeline(nextStatus);
    if (nextStatus === 'completed') {
      order.status = 'completed';
      order.issueFlag = false;
    }
    return simulateRequest(order, { delay: 240 });
  },
};
