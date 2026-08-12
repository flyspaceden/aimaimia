import { ConfigService } from '@nestjs/config';
import {
  WechatMiniProgramApiError,
  WechatMiniProgramApiService,
} from './wechat-mini-program-api.service';

function makeService(values: Record<string, string> = {}) {
  const config = {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
  const service = new WechatMiniProgramApiService(config);
  service.onModuleInit();
  return service;
}

describe('WechatMiniProgramApiService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fails closed without Mini Program credentials', async () => {
    const service = makeService();
    expect(service.isAvailable()).toBe(false);
    expect(service.getAppId()).toBeNull();
    await expect(service.getAccessToken()).rejects.toThrow('微信小程序平台服务未配置');
  });

  it('rejects Mock mode in production even when real credentials are present', async () => {
    const service = makeService({
      NODE_ENV: 'production',
      WECHAT_MINIAPP_MOCK: 'true',
      WECHAT_MINIAPP_APP_ID: 'wx-real',
      WECHAT_MINIAPP_APP_SECRET: 'secret-real',
    });
    expect(service.isAvailable()).toBe(false);
    expect(service.getAppId()).toBeNull();
    await expect(service.getAccessToken()).rejects.toThrow('微信小程序平台服务未配置');
  });

  it('caches stable_token and never includes credentials in the business request body', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'stable-secret-token',
        expires_in: 7200,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    global.fetch = fetchMock as typeof fetch;
    const service = makeService({
      WECHAT_MINIAPP_APP_ID: 'wx-app-id',
      WECHAT_MINIAPP_APP_SECRET: 'wx-app-secret',
    });

    await service.postJson('/wxa/test', { hello: 'world' });
    await service.postJson('/wxa/test', { hello: 'again' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tokenBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(tokenBody).toEqual({
      grant_type: 'client_credential',
      appid: 'wx-app-id',
      secret: 'wx-app-secret',
      force_refresh: false,
    });
    const businessBody = String(fetchMock.mock.calls[1][1]?.body);
    expect(businessBody).not.toContain('wx-app-secret');
    expect(businessBody).not.toContain('stable-secret-token');
    expect(String(fetchMock.mock.calls[1][0])).toContain('access_token=stable-secret-token');
  });

  it('refreshes stable_token once after an invalid token and then returns binary content', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'token-1',
        expires_in: 7200,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        errcode: 40014,
        errmsg: 'invalid access token',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'token-2',
        expires_in: 7200,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));
    global.fetch = fetchMock as typeof fetch;
    const service = makeService({
      WECHAT_MINIAPP_APP_ID: 'wx-app-id',
      WECHAT_MINIAPP_APP_SECRET: 'wx-app-secret',
    });

    const image = await service.postBuffer('/wxa/getwxacodeunlimit', { scene: 'abc' });

    expect(image).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual(
      expect.objectContaining({ force_refresh: false }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not accept JSON errors as image bytes', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'token-1',
        expires_in: 7200,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        errcode: 45009,
        errmsg: 'quota exceeded',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    global.fetch = fetchMock as typeof fetch;
    const service = makeService({
      WECHAT_MINIAPP_APP_ID: 'wx-app-id',
      WECHAT_MINIAPP_APP_SECRET: 'wx-app-secret',
    });

    await expect(service.postBuffer('/wxa/getwxacodeunlimit', {})).rejects.toMatchObject({
      errcode: 45009,
    } satisfies Partial<WechatMiniProgramApiError>);
  });

  it('accepts WeChat JPEG binary responses for unlimited codes', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'token-1',
        expires_in: 7200,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(jpeg, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      }));
    global.fetch = fetchMock as typeof fetch;
    const service = makeService({
      WECHAT_MINIAPP_APP_ID: 'wx-app-id',
      WECHAT_MINIAPP_APP_SECRET: 'wx-app-secret',
    });

    await expect(service.postBuffer('/wxa/getwxacodeunlimit', {})).resolves.toEqual(jpeg);
  });

  it('stops reading binary responses larger than one MiB', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'token-1',
        expires_in: 7200,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(Buffer.alloc(1024 * 1024 + 1, 1), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }));
    global.fetch = fetchMock as typeof fetch;
    const service = makeService({
      WECHAT_MINIAPP_APP_ID: 'wx-app-id',
      WECHAT_MINIAPP_APP_SECRET: 'wx-app-secret',
    });

    await expect(service.postBuffer('/wxa/getwxacodeunlimit', {}))
      .rejects.toThrow('微信小程序平台响应过大');
  });
});
