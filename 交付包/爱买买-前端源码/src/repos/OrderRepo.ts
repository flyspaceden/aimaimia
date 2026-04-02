/**
 * 订单仓储（Repo）
 *
 * 当前实现：
 * - 使用 `src/mocks/orders.ts` 初始化 `orderStore`，并在内存中模拟下单/支付/售后流转
 *
 * 后端接入说明：
 * - 建议把订单状态机、支付回调、售后审核/退款回调全部放后端
 * - 前端只做展示与触发动作：替换本 Repo 的方法为 HTTP 请求即可
 *
 * 建议接口（节选）：
 * - `GET /api/v1/orders?status=`、`GET /api/v1/orders/{id}`
 * - `POST /api/v1/orders`（从购物车下单）
 * - `POST /api/v1/orders/{id}/pay`
 * - `POST /api/v1/orders/{id}/after-sale`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#6-订单order--aftersale--checkout`
 */
import { mockOrders } from '../mocks';
import { Order, OrderItem, OrderStatus, PaymentMethod, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';

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
  if (status === 'reviewing' || status === 'refunding' || status === 'completed') {
    push('reviewing', '平台审核');
  }
  if (status === 'refunding' || status === 'completed') {
    push('refunding', '退款处理中');
  }
  if (status === 'completed') {
    push('completed', '售后完成');
  }
  return timeline;
};

// 订单仓储：订单列表与详情
export const OrderRepo = {
  /**
   * 订单列表（可按状态筛选）
   * - 用途：订单列表页
   * - 后端建议：`GET /api/v1/orders?status=`
   */
  list: async (status?: OrderStatus): Promise<Result<Order[]>> => {
    // 订单列表：支持按状态筛选（复杂业务逻辑需中文注释）
    const orders = status ? orderStore.filter((order) => order.status === status) : orderStore;
    return simulateRequest(orders);
  },
  /**
   * 订单状态角标统计
   * - 用途：我的页“待付款/待发货/待收货/退款售后”角标
   * - 后端建议：`GET /api/v1/orders/status-counts`
   */
  getStatusCounts: async (): Promise<Result<Record<OrderStatus, number>>> => {
    // 订单状态角标统计（复杂业务逻辑需中文注释）
    const counts: Record<OrderStatus, number> = {
      pendingPay: 0,
      pendingShip: 0,
      shipping: 0,
      afterSale: 0,
      completed: 0,
    };
    orderStore.forEach((order) => {
      counts[order.status] = (counts[order.status] ?? 0) + 1;
    });
    return simulateRequest(counts);
  },
  /**
   * 最近异常订单
   * - 用途：我的页“智能售后入口”直达问题订单
   * - 后端建议：`GET /api/v1/orders/latest-issue`
   */
  getLatestIssue: async (): Promise<Result<Order | null>> => {
    // 最近异常订单：用于售后入口直达（复杂业务逻辑需中文注释）
    const issue = orderStore.find((order) => order.issueFlag || order.status === 'afterSale') ?? null;
    return simulateRequest(issue);
  },
  /**
   * 订单详情
   * - 用途：订单详情页
   * - 后端建议：`GET /api/v1/orders/{id}`
   */
  getById: async (id: string): Promise<Result<Order>> => {
    const order = orderStore.find((item) => item.id === id);
    if (!order) {
      return err(createAppError('NOT_FOUND', `订单不存在: ${id}`, '订单未找到'));
    }
    return simulateRequest(order);
  },
  // 下单：从购物车生成订单（复杂业务逻辑需中文注释）
  /**
   * 下单（从购物车生成订单）
   * - 用途：结算页点击“提交订单”
   * - 后端建议：`POST /api/v1/orders`
   * - body：`{ items: OrderItem[], paymentMethod }`
   */
  createFromCart: async (payload: {
    items: OrderItem[];
    paymentMethod: PaymentMethod;
  }): Promise<Result<Order>> => {
    if (payload.items.length === 0) {
      return err(createAppError('INVALID', '购物车为空', '请先添加商品'));
    }
    const newOrder: Order = {
      id: `o-${Date.now()}`,
      status: 'pendingPay',
      totalPrice: buildOrderTotal(payload.items),
      createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      items: payload.items,
      paymentMethod: payload.paymentMethod,
    };
    orderStore = [newOrder, ...orderStore];
    return simulateRequest(newOrder, { delay: 260 });
  },
  // 支付订单：支付成功后进入待发货（复杂业务逻辑需中文注释）
  /**
   * 支付订单
   * - 用途：订单详情/结算页发起支付
   * - 后端建议：`POST /api/v1/orders/{id}/pay`
   * - body：`{ paymentMethod }`
   * - 说明：真实支付需对接微信/支付宝，支付结果以回调为准
   */
  payOrder: async (orderId: string, paymentMethod: PaymentMethod): Promise<Result<Order>> => {
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
  },
  // 申请售后：生成售后单并进入审核（复杂业务逻辑需中文注释）
  /**
   * 申请售后
   * - 用途：订单详情 -> 申请退款/售后
   * - 后端建议：`POST /api/v1/orders/{id}/after-sale`
   * - body：`{ reason, note? }`
   */
  applyAfterSale: async (payload: {
    orderId: string;
    reason: string;
    note?: string;
  }): Promise<Result<Order>> => {
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
    order.afterSaleReason = payload.reason;
    order.afterSaleNote = payload.note;
    order.afterSaleTimeline = buildAfterSaleTimeline('applying');
    return simulateRequest(order, { delay: 260 });
  },
  // 推进售后流程：用于前端模拟审核/退款（复杂业务逻辑需中文注释）
  /**
   * 推进售后流程（仅前端模拟/测试）
   * - 真实后端：应由运营审核/退款回调/定时任务推进状态机
   * - 建议：不要对 C 端开放该接口；可仅在管理端/测试环境开放
   */
  advanceAfterSale: async (orderId: string): Promise<Result<Order>> => {
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
      reviewing: 'refunding',
      refunding: 'completed',
      completed: 'completed',
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
