import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestMiniProgramSubscriptions, requestOptionalMiniProgramSubscriptions } from '../subscriptions';

const requestSubscribeMessage = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@tarojs/taro', () => ({ default: { requestSubscribeMessage } }));
vi.mock('@/api/client', () => ({ ApiClient: { get, post } }));

describe('mini program subscriptions', () => {
  beforeEach(() => {
    requestSubscribeMessage.mockReset();
    get.mockReset();
    post.mockReset();
  });

  it('requests only configured templates and records the exact platform result', async () => {
    get.mockResolvedValue({ ok: true, data: [
      { key: 'ORDER_SHIPPED', templateId: 'tmpl-order', label: '发货', description: '', configured: true },
      { key: 'WITHDRAW_RESULT', templateId: '', label: '提现', description: '', configured: false },
    ] });
    requestSubscribeMessage.mockResolvedValue({ errMsg: 'requestSubscribeMessage:ok', 'tmpl-order': 'accept' });
    post.mockResolvedValue({ ok: true, data: { recorded: 1 } });

    const result = await requestMiniProgramSubscriptions(['ORDER_SHIPPED', 'WITHDRAW_RESULT']);
    expect(requestSubscribeMessage).toHaveBeenCalledWith({ tmplIds: ['tmpl-order'] });
    expect(post).toHaveBeenCalledWith(
      '/mini-program/subscriptions/consents',
      expect.objectContaining({ results: [{ key: 'ORDER_SHIPPED', templateId: 'tmpl-order', status: 'accept' }] }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^mini-sub-/) }),
    );
    expect(result).toMatchObject({ ok: true, data: { accepted: ['ORDER_SHIPPED'], unavailable: ['WITHDRAW_RESULT'] } });
  });

  it('does not open a fake panel when no template id is configured', async () => {
    get.mockResolvedValue({ ok: true, data: [
      { key: 'ORDER_SHIPPED', templateId: '', label: '发货', description: '', configured: false },
    ] });
    const result = await requestMiniProgramSubscriptions(['ORDER_SHIPPED']);
    expect(result).toMatchObject({ ok: false, error: { code: 'SUBSCRIPTION_TEMPLATES_NOT_CONFIGURED' } });
    expect(requestSubscribeMessage).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('uses preloaded templates so the native panel follows the user click without a network gap', async () => {
    requestSubscribeMessage.mockResolvedValue({ errMsg: 'requestSubscribeMessage:ok', 'tmpl-order': 'accept' });
    post.mockResolvedValue({ ok: true, data: { recorded: 1 } });

    const result = await requestMiniProgramSubscriptions(['ORDER_SHIPPED'], [{
      key: 'ORDER_SHIPPED', templateId: 'tmpl-order', label: '发货', description: '', configured: true,
    }]);

    expect(result).toMatchObject({ ok: true, data: { accepted: ['ORDER_SHIPPED'] } });
    expect(get).not.toHaveBeenCalled();
    expect(requestSubscribeMessage).toHaveBeenCalledWith({ tmplIds: ['tmpl-order'] });
  });

  it('keeps optional subscriptions from failing the surrounding business action', async () => {
    get.mockRejectedValue(new Error('template service unavailable'));

    await expect(requestOptionalMiniProgramSubscriptions(['AFTER_SALE_RESULT'])).resolves.toBeUndefined();
  });
});
