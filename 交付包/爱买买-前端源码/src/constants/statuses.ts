import { BookingStatus, GroupStatus, OrderStatus, WishStatus } from '../types';

export const orderStatusLabels: Record<OrderStatus, string> = {
  pendingPay: '待付款',
  pendingShip: '待发货',
  shipping: '待收货',
  afterSale: '退款/售后',
  completed: '已完成',
};

export const wishStatusLabels: Record<WishStatus, string> = {
  adopted: '已采纳',
  planning: '规划中',
  done: '已实现',
};

export const bookingStatusLabels: Record<BookingStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  invited: '待成团邀请',
  joined: '已参团待支付',
  paid: '已支付',
};

export const groupStatusLabels: Record<GroupStatus, string> = {
  forming: '组团中',
  inviting: '成团邀请',
  confirmed: '待支付',
  paid: '已支付',
  completed: '已完成',
};
