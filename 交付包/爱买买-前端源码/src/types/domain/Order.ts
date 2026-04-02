/**
 * 域模型：订单（Order）
 *
 * 用途：
 * - 订单列表/详情、支付方式、售后状态与时间线
 *
 * 后端接入建议：
 * - 订单/售后状态机应由后端推进，前端只做展示与触发（见 `说明文档/后端接口清单.md#6-订单order--aftersale--checkout`）
 */
export type OrderStatus = 'pendingPay' | 'pendingShip' | 'shipping' | 'afterSale' | 'completed';

import { PaymentMethod } from './Payment';

export type AfterSaleStatus = 'applying' | 'reviewing' | 'refunding' | 'completed';

export type AfterSaleProgress = {
  status: AfterSaleStatus;
  title: string;
  time: string;
  note?: string;
};

export type OrderItem = {
  id: string;
  productId: string;
  title: string;
  image: string;
  price: number;
  quantity: number;
};

export type Order = {
  id: string;
  status: OrderStatus;
  issueFlag?: boolean;
  afterSaleStatus?: AfterSaleStatus;
  afterSaleReason?: string;
  afterSaleNote?: string;
  afterSaleTimeline?: AfterSaleProgress[];
  paymentMethod?: PaymentMethod;
  logisticsStatus?: string;
  tracePreview?: string;
  totalPrice: number;
  createdAt: string;
  items: OrderItem[];
};
