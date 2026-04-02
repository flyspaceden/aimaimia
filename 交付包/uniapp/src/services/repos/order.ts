// 订单仓库：订单列表/详情/售后接口占位
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type OrderStatus = 'pendingPay' | 'pendingShip' | 'shipping' | 'afterSale' | 'completed';

export type OrderItem = {
  id: string;
  title: string;
  image: string;
  quantity: number;
  price: number;
};

export type Order = {
  id: string;
  title: string;
  status: string;
  statusCode: OrderStatus;
  amount: string;
  afterSaleStatus?: 'applying' | 'reviewing' | 'refunding' | 'completed';
  issueFlag?: boolean;
  createdAt?: string;
  items: OrderItem[];
  totalPrice: number;
};

export type OrderDetail = Order & {
  createdAt: string;
  logisticsStatus?: string;
  tracePreview?: string;
  totalPrice: number;
  paymentMethod?: 'wechat' | 'alipay';
  afterSaleTimeline?: Array<{ status: string; title: string; time: string; note?: string }>;
  items: OrderItem[];
};

const orders: Order[] = [
  {
    id: 'o1',
    title: '有机小番茄礼盒',
    status: '待付款',
    statusCode: 'pendingPay',
    amount: '39.9',
    createdAt: '2024-12-05 09:10',
    totalPrice: 39.9,
    items: [
      { id: 'i1', title: '有机小番茄礼盒', image: 'https://placehold.co/200x200/png', quantity: 1, price: 39.9 },
    ],
  },
  {
    id: 'o2',
    title: '高山蓝莓鲜果',
    status: '待发货',
    statusCode: 'pendingShip',
    amount: '59.0',
    createdAt: '2024-12-04 16:20',
    totalPrice: 59.0,
    items: [
      { id: 'i2', title: '高山蓝莓鲜果', image: 'https://placehold.co/200x200/png', quantity: 1, price: 59.0 },
    ],
  },
  {
    id: 'o3',
    title: '原香糯玉米',
    status: '待收货',
    statusCode: 'shipping',
    amount: '12.8',
    createdAt: '2024-12-03 12:40',
    totalPrice: 12.8,
    items: [
      { id: 'i3', title: '原香糯玉米', image: 'https://placehold.co/200x200/png', quantity: 1, price: 12.8 },
    ],
  },
  {
    id: 'o4',
    title: '阳光草莓',
    status: '售后处理中',
    statusCode: 'afterSale',
    amount: '29.9',
    createdAt: '2024-12-01 18:30',
    totalPrice: 29.9,
    afterSaleStatus: 'reviewing',
    issueFlag: true,
    items: [
      { id: 'i4', title: '阳光草莓', image: 'https://placehold.co/200x200/png', quantity: 2, price: 14.95 },
    ],
  },
  {
    id: 'o5',
    title: '山谷果园礼盒',
    status: '已完成',
    statusCode: 'completed',
    amount: '86.0',
    createdAt: '2024-11-28 14:20',
    totalPrice: 86.0,
    items: [
      { id: 'i5', title: '山谷果园礼盒', image: 'https://placehold.co/200x200/png', quantity: 2, price: 43.0 },
    ],
  },
];

const orderDetails: OrderDetail[] = [
  {
    id: 'o1',
    title: '有机小番茄礼盒',
    status: '待付款',
    statusCode: 'pendingPay',
    amount: '39.9',
    createdAt: '2024-12-05 09:10',
    logisticsStatus: '待发货',
    tracePreview: '预计 2 天内送达',
    totalPrice: 39.9,
    paymentMethod: 'wechat',
    items: [
      { id: 'i1', title: '有机小番茄礼盒', image: 'https://placehold.co/200x200/png', quantity: 1, price: 39.9 },
    ],
  },
  {
    id: 'o4',
    title: '阳光草莓',
    status: '售后处理中',
    statusCode: 'afterSale',
    amount: '29.9',
    afterSaleStatus: 'reviewing',
    issueFlag: true,
    createdAt: '2024-12-01 18:30',
    logisticsStatus: '运输中',
    tracePreview: '预计明日送达',
    totalPrice: 29.9,
    paymentMethod: 'alipay',
    afterSaleTimeline: [
      { status: 'applying', title: '提交申请', time: '2024-12-02 09:10' },
      { status: 'reviewing', title: '平台审核', time: '2024-12-02 12:30' },
      { status: 'refunding', title: '退款处理中', time: '2024-12-03 10:20' },
    ],
    items: [
      { id: 'i4', title: '阳光草莓', image: 'https://placehold.co/200x200/png', quantity: 2, price: 14.95 },
    ],
  },
];

export const OrderRepo = {
  list: async (params: { page: number; pageSize: number; status?: string }): Promise<Result<PagedResult<Order>>> => {
    const status = params.status;
    const filtered = status
      ? orders.filter((item) => item.statusCode === status || item.status === status)
      : orders;
    return mockPage(filtered, params.page, params.pageSize);
  },
  // 状态数量占位：用于“我的”页角标统计
  getStatusCounts: async (): Promise<Result<Record<OrderStatus, number>>> => {
    const counts: Record<OrderStatus, number> = {
      pendingPay: 0,
      pendingShip: 0,
      shipping: 0,
      afterSale: 0,
      completed: 0,
    };
    orders.forEach((item) => {
      counts[item.statusCode] += 1;
    });
    return { ok: true, data: counts };
  },
  // 异常订单占位：用于“我的”页售后进度条
  getLatestIssue: async (): Promise<Result<Order | null>> => {
    const issue = orders.find((item) => item.issueFlag) || null;
    return { ok: true, data: issue };
  },
  // 订单详情：后端需返回订单与商品明细
  getById: async (orderId: string): Promise<Result<OrderDetail>> => {
    const detail = orderDetails.find((item) => item.id === orderId);
    if (!detail) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '订单不存在' } };
    }
    return { ok: true, data: detail };
  },
  // 购物车下单占位：后端需创建订单并返回订单号
  createFromCart: async (payload: {
    items: Array<{ productId: string; title: string; image: string; price: number; quantity: number }>;
    paymentMethod: 'wechat' | 'alipay';
  }): Promise<Result<{ id: string }>> => {
    if (!payload.items.length) {
      return { ok: false, error: { code: 'INVALID', message: '购物车为空' } };
    }
    return { ok: true, data: { id: `order-${Date.now()}` } };
  },
  // 支付订单占位：后端需处理支付参数/回调
  payOrder: async (orderId: string, paymentMethod: 'wechat' | 'alipay'): Promise<Result<{ ok: true }>> => {
    if (!orderId) {
      return { ok: false, error: { code: 'INVALID', message: '缺少订单信息' } };
    }
    return { ok: true, data: { ok: true } };
  },
  // 推进售后占位：仅用于前端演示
  advanceAfterSale: async (orderId: string): Promise<Result<{ ok: true }>> => {
    if (!orderId) {
      return { ok: false, error: { code: 'INVALID', message: '缺少订单信息' } };
    }
    return { ok: true, data: { ok: true } };
  },
  // 售后申请：后端需创建售后单并更新订单状态
  applyAfterSale: async (payload: { orderId: string; reason: string; note?: string }): Promise<Result<{ ok: true }>> => {
    if (!payload.orderId || !payload.reason) {
      return { ok: false, error: { code: 'INVALID', message: '售后信息不完整' } };
    }
    return { ok: true, data: { ok: true } };
  },
};
