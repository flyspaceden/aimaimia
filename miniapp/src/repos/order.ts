import { ApiClient } from '@/api/client';
import type {
  Order,
  OrderListFilter,
  OrderStatusCounts,
  PickupPass,
  PageQuery,
  PageResult,
  RepurchaseResult,
  Result,
  UpdateReceiverInfoInput,
} from '@/types';
import { invalidContract, normalizePageResult } from './contracts';

type WireOrder = Omit<Order, 'paymentMethod'> & { paymentMethod?: unknown };

const READABLE_ORDER_STATUSES = new Set<Order['status']>([
  'PENDING_PAYMENT',
  'PAID',
  'SHIPPED',
  'DELIVERED',
  'RECEIVED',
  'CANCELED',
  'REFUNDED',
]);

function isReadableOrderStatus(value: unknown): value is Order['status'] {
  return typeof value === 'string'
    && READABLE_ORDER_STATUSES.has(value as Order['status']);
}

function normalizeOrder(raw: WireOrder): Order {
  const paymentMethod = raw.paymentMethod === undefined
    ? undefined
    : raw.paymentMethod === 'wechat'
      ? 'wechat' as const
      : 'other' as const;
  return { ...raw, paymentMethod };
}

function isWireOrder(value: unknown): value is WireOrder {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.id === 'string'
    && isReadableOrderStatus(raw.status)
    && typeof raw.totalPrice === 'number'
    && typeof raw.createdAt === 'string'
    && Array.isArray(raw.items);
}

async function normalizeOrderResult(
  result: Promise<Result<unknown>>,
  contract: string,
): Promise<Result<Order>> {
  const resolved = await result;
  if (!resolved.ok) return resolved;
  return isWireOrder(resolved.data)
    ? { ok: true, data: normalizeOrder(resolved.data) }
    : invalidContract(contract);
}

export const OrderRepo = {
  async list(
    status?: OrderListFilter,
    query: PageQuery = {},
  ): Promise<Result<PageResult<Order>>> {
    const raw = await ApiClient.get<unknown>('/orders', {
      status,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
    const normalized = normalizePageResult<WireOrder>(raw, 'orders page');
    if (!normalized.ok) return normalized;
    if (!normalized.data.items.every(isWireOrder)) return invalidContract('orders page');
    return {
      ok: true,
      data: {
        ...normalized.data,
        items: normalized.data.items.map(normalizeOrder),
      },
    };
  },

  getStatusCounts: (): Promise<Result<OrderStatusCounts>> =>
    ApiClient.get<OrderStatusCounts>('/orders/status-counts'),

  async getById(orderId: string): Promise<Result<Order>> {
    return normalizeOrderResult(
      ApiClient.get<unknown>(`/orders/${orderId}`),
      'order detail',
    );
  },

  updateReceiverInfo: (
    orderId: string,
    input: UpdateReceiverInfoInput,
  ): Promise<Result<Order>> => normalizeOrderResult(
    ApiClient.put<unknown>(`/orders/${orderId}/receiver-info`, input),
    'updated order',
  ),

  confirmReceive: (orderId: string): Promise<Result<Order>> => normalizeOrderResult(
    ApiClient.post<unknown>(`/orders/${orderId}/receive`),
    'received order',
  ),

  repurchase: (orderId: string): Promise<Result<RepurchaseResult>> =>
    ApiClient.post<RepurchaseResult>(`/orders/${orderId}/repurchase`),

  cancelPaidUnshipped: (orderId: string): Promise<Result<Order>> => normalizeOrderResult(
    ApiClient.post<unknown>(`/orders/${orderId}/cancel`),
    'canceled order',
  ),

  getPickupPass: (orderId: string): Promise<Result<PickupPass>> =>
    ApiClient.get<PickupPass>(`/orders/${orderId}/pickup-pass`),
};
