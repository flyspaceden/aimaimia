import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerServiceRepo, normalizeCsSource } from '../repo';
import { mergeCsMessages, mergeCsSessionPages, nextCsSessionPage, normalizeSocketMessage } from '../utils';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ ApiClient: { get: getMock, post: postMock } }));

describe('customer service miniapp contracts', () => {
  beforeEach(() => { getMock.mockReset(); postMock.mockReset(); });

  it('uses the buyer-owned REST endpoints and sends TEXT explicitly', async () => {
    getMock.mockResolvedValue({ ok: true, data: [] });
    postMock.mockResolvedValue({ ok: true, data: {} });
    await CustomerServiceRepo.getMessages('session/a');
    await CustomerServiceRepo.sendMessage('session/a', '你好');
    expect(getMock).toHaveBeenCalledWith('/cs/sessions/session%2Fa/messages');
    expect(postMock).toHaveBeenCalledWith('/cs/sessions/session%2Fa/messages', { content: '你好', contentType: 'TEXT' });
  });

  it('accepts only supported session sources from route parameters', () => {
    expect(normalizeCsSource('ORDER_DETAIL')).toBe('ORDER_DETAIL');
    expect(normalizeCsSource('ADMIN_OUTREACH')).toBe('MY_PAGE');
    expect(normalizeCsSource('ADMIN')).toBe('MY_PAGE');
  });

  it('merges snapshots without dropping newer socket messages', () => {
    const old = { id: '1', sessionId: 's', senderType: 'AI' as const, contentType: 'TEXT' as const, content: '早', createdAt: '2026-08-02T10:00:00Z' };
    const fresh = { ...old, id: '2', content: '新', createdAt: '2026-08-02T10:01:00Z' };
    expect(mergeCsMessages([fresh], [old]).map((item) => item.id)).toEqual(['1', '2']);
  });

  it('paginates session lists and removes overlapping session ids', () => {
    const session = (id: string) => ({
      id,
      status: 'AI_HANDLING' as const,
      source: 'MY_PAGE' as const,
      createdAt: `2026-08-02T10:0${id.slice(-1)}:00Z`,
      unreadCount: 0,
      lastMessage: null,
    });
    const first = { ok: true as const, data: { items: [session('s1'), session('s2')], page: 1, pageSize: 2 } };
    const second = { ok: true as const, data: { items: [session('s2'), session('s3')], page: 2, pageSize: 2 } };
    const final = { ok: true as const, data: { items: [session('s4')], page: 3, pageSize: 2 } };

    expect(nextCsSessionPage(first)).toBe(2);
    expect(nextCsSessionPage(final)).toBeUndefined();
    expect(mergeCsSessionPages([first, second, final]).map((item) => item.id)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('drops socket events for a different session', () => {
    expect(normalizeSocketMessage({ sessionId: 'other', senderType: 'AGENT', content: 'x' }, 'mine')).toBeNull();
  });

  it('drops malformed sender types before rendering', () => {
    expect(normalizeSocketMessage({
      id: 'message-1',
      sessionId: 'mine',
      senderType: { forged: true },
      contentType: 'TEXT',
      content: 'x',
      createdAt: '2026-08-02T10:00:00.000Z',
    }, 'mine')).toBeNull();
    expect(normalizeSocketMessage({
      id: 'message-2',
      sessionId: 'mine',
      senderType: 'UNKNOWN',
      contentType: 'TEXT',
      content: 'x',
      createdAt: '2026-08-02T10:00:00.000Z',
    }, 'mine')).toBeNull();
  });

  it('accepts normal Prisma nullable message fields', () => {
    expect(normalizeSocketMessage({
      id: 'message-1',
      sessionId: 'mine',
      senderType: 'AI',
      senderId: null,
      contentType: 'TEXT',
      content: '你好',
      metadata: null,
      createdAt: '2026-08-02T10:00:00.000Z',
    }, 'mine')).toEqual(expect.objectContaining({
      id: 'message-1', senderType: 'AI', content: '你好',
    }));
  });

  it('rejects a malformed REST message snapshot instead of passing it to the page', async () => {
    getMock.mockResolvedValue({
      ok: true,
      data: [{
        id: 'message-1', sessionId: 'session/a', senderType: 'BROKEN', contentType: 'TEXT',
        content: 'x', createdAt: '2026-08-02T10:00:00.000Z',
      }],
    });

    await expect(CustomerServiceRepo.getMessages('session/a')).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    }));
  });
});
