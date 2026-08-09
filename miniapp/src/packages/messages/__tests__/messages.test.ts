import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageRepo } from '../repo';
import { formatMessageTime, resolveMessageRoute } from '../utils';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ ApiClient: { get: getMock, post: postMock, delete: deleteMock } }));

describe('miniapp message center contracts', () => {
  beforeEach(() => { getMock.mockReset(); postMock.mockReset(); deleteMock.mockReset(); });

  it('passes server-side filters and pagination unchanged', async () => {
    getMock.mockResolvedValue({ ok: true, data: [] });
    await MessageRepo.list('transaction', true, 3, 20);
    expect(getMock).toHaveBeenCalledWith('/inbox', { category: 'transaction', unreadOnly: 'true', page: 3, pageSize: 20 });
  });

  it('maps canonical routes only when required identifiers exist', () => {
    expect(resolveMessageRoute({ routeKey: 'ORDER_DETAIL', params: { id: 'order/1' } })).toEqual({ label: '查看订单', url: '/packages/orders/order-detail/index?id=order%2F1' });
    expect(resolveMessageRoute({ routeKey: 'ORDER_DETAIL', params: {} })).toBeNull();
    expect(resolveMessageRoute({ routeKey: 'AFTER_SALE_DETAIL', params: { id: 'as/1' } })?.url).toContain('id=as%2F1');
    expect(resolveMessageRoute({ routeKey: 'INVOICE_DETAIL', params: { id: 'invoice-1' } })?.url).toContain('invoice-1');
    expect(resolveMessageRoute({ routeKey: 'GROUP_BUY_DETAIL', params: { activityId: 'gb-1' } })?.url).toContain('activityId=gb-1');
  });

  it('rejects arbitrary legacy and external routes', () => {
    expect(resolveMessageRoute({ route: '/admin/users' })).toBeNull();
    expect(resolveMessageRoute({ route: 'https://example.com' })).toBeNull();
  });

  it('formats invalid timestamps without throwing', () => {
    expect(formatMessageTime('not-a-date')).toBe('not-a-date');
  });
});
