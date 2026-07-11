/// <reference types="jest" />

jest.mock('../http/config', () => ({
  API_BASE_URL: 'https://api.example.test',
  USE_MOCK: false,
}));

jest.mock('../../utils/logout', () => ({
  logoutAndClearClientState: jest.fn(),
}));

import { InboxRepo } from '../InboxRepo';

describe('InboxRepo deletion endpoints', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
    jest.clearAllMocks();
  });

  function mockFetch(data: unknown) {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: jest.fn().mockResolvedValue({ ok: true, data }),
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });
    return fetchMock;
  }

  it('soft deletes and restores one buyer message', async () => {
    const fetchMock = mockFetch({ id: 'message-1', deletedCount: 1 });

    await InboxRepo.deleteMessage('message-1');
    await InboxRepo.restoreMessage('message-1');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/inbox/message-1');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/inbox/message-1/restore');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'POST' }));
  });

  it('uses separate endpoints for clearing read messages and all messages', async () => {
    const fetchMock = mockFetch({ deletedCount: 3 });

    await InboxRepo.deleteReadMessages();
    await InboxRepo.deleteAllMessages();

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/inbox/read');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/inbox/all');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
  });
});
