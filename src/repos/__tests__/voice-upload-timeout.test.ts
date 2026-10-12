import { ApiClient } from '../http/ApiClient';
jest.mock('../http/config', () => ({ API_BASE_URL: 'https://api.example.invalid' }));
jest.mock('../../utils/logout', () => ({ logoutAndClearClientState: jest.fn() }));
jest.mock('../../store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ accessToken: undefined }) } }));

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(globalThis, 'fetch').mockImplementation((_url: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

describe('voice upload timeout budget', () => {
  it.each(['/ai/voice-intent', '/ai/voice-intent?page=home'])('keeps %s alive beyond 30 seconds and still bounds the request', async (path) => {
    let settled = false;
    const result = ApiClient.upload(path, new FormData());
    void result.then(() => { settled = true; });
    await jest.advanceTimersByTimeAsync(59000);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toMatchObject({ ok: false, error: { message: '上传超时' } });
  });

  it('keeps ordinary uploads on the existing 30-second budget', async () => {
    const result = ApiClient.upload('/upload', new FormData());
    await jest.advanceTimersByTimeAsync(30000);
    await expect(result).resolves.toMatchObject({ ok: false, error: { message: '上传超时' } });
  });
});
