/// <reference types="jest" />

jest.mock('../http/config', () => ({
  API_BASE_URL: 'https://api.example.test',
}));

jest.mock('../../utils/logout', () => ({
  logoutAndClearClientState: jest.fn(),
}));

import { ApiClient } from '../http/ApiClient';

describe('ApiClient cache handling', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
    jest.clearAllMocks();
  });

  test('retries a no-cache GET with a cache buster when the API returns 304', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        status: 304,
        json: jest.fn(() => {
          throw new Error('304 responses do not have a JSON body');
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: jest.fn().mockResolvedValue({
          ok: true,
          data: {
            current: null,
            occupiesSlot: false,
            defaultTab: 'PRODUCTS',
            canBuyNew: true,
          },
        }),
      });
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });

    const result = await ApiClient.get('/group-buy/me/current', undefined, { noCache: true });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/group-buy/me/current');
    expect(fetchMock.mock.calls[0][1].headers).toEqual(expect.objectContaining({
      'Cache-Control': 'no-cache, no-store',
      Pragma: 'no-cache',
    }));
    expect(fetchMock.mock.calls[1][0]).toMatch(
      /^https:\/\/api\.example\.test\/group-buy\/me\/current\?__t=\d+$/,
    );
  });
});
