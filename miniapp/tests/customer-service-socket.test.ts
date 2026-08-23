import { describe, expect, it, vi } from 'vitest';

import { CustomerServiceSocket } from '@/platform/customerServiceSocket';
import { useAuthStore } from '@/store/auth';

const connectSocketMock = vi.hoisted(() => vi.fn());

vi.mock('@tarojs/taro', () => ({
  default: {
    connectSocket: connectSocketMock,
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  },
}));

describe('CustomerServiceSocket', () => {
  it('speaks the Socket.IO namespace protocol over a WeChat SocketTask', async () => {
    let onMessage: ((event: { data: string }) => void) | undefined;
    let onClose: (() => void) | undefined;
    const sent: string[] = [];
    const task = {
      onMessage: vi.fn((handler) => { onMessage = handler; }),
      onError: vi.fn(),
      onClose: vi.fn((handler) => { onClose = handler; }),
      send: vi.fn(({ data }) => sent.push(data)),
      close: vi.fn(),
    };
    connectSocketMock.mockResolvedValue(task);

    useAuthStore.setState({
      accessToken: 'access-token', refreshToken: 'refresh-token', userId: 'user-a', revision: 1,
      hydrated: true,
    });
    const socket = new CustomerServiceSocket('access-token', 'wss://test-api.ai-maimai.com');
    const messageHandler = vi.fn();
    socket.on('cs:message', messageHandler);
    socket.emit('cs:join_session', { sessionId: 'session-1' });
    await socket.connect();

    onMessage?.({ data: '0{"sid":"engine-1"}' });
    expect(sent).toContain('40/cs,{"token":"access-token"}');

    onMessage?.({ data: '40/cs,{"sid":"namespace-1"}' });
    expect(sent).toContain('42/cs,["cs:join_session",{"sessionId":"session-1"}]');
    expect(socket.isConnected()).toBe(true);

    onMessage?.({ data: '42/cs,["cs:message",{"id":"message-1"}]' });
    expect(messageHandler).toHaveBeenCalledWith({ id: 'message-1' });

    onMessage?.({ data: '2' });
    expect(sent).toContain('3');

    socket.disconnect();
    expect(task.close).toHaveBeenCalled();
    onClose?.();
  });

  it('disconnects and ignores late packets immediately when the auth generation changes', async () => {
    let onMessage: ((event: { data: string }) => void) | undefined;
    const task = {
      onMessage: vi.fn((handler) => { onMessage = handler; }),
      onError: vi.fn(),
      onClose: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
    };
    connectSocketMock.mockResolvedValue(task);
    useAuthStore.setState({
      accessToken: 'access-a', refreshToken: 'refresh-a', userId: 'user-a', revision: 7,
      hydrated: true,
    });
    const socket = new CustomerServiceSocket('access-a', 'wss://test-api.ai-maimai.com');
    const messageHandler = vi.fn();
    socket.on('cs:message', messageHandler);
    await socket.connect();

    useAuthStore.getState().setSession({
      accessToken: 'access-b', refreshToken: 'refresh-b', userId: 'user-b',
    });
    onMessage?.({ data: '42/cs,["cs:message",{"id":"late-a"}]' });

    expect(task.close).toHaveBeenCalled();
    expect(messageHandler).not.toHaveBeenCalled();
    expect(socket.isConnected()).toBe(false);
  });

  it('deduplicates concurrent connect calls', async () => {
    let resolveSocket!: (task: any) => void;
    const socketTaskPromise = new Promise<any>((resolve) => { resolveSocket = resolve; });
    const task = {
      onMessage: vi.fn(), onError: vi.fn(), onClose: vi.fn(), send: vi.fn(), close: vi.fn(),
    };
    connectSocketMock.mockReturnValue(socketTaskPromise);
    useAuthStore.setState({
      accessToken: 'access-a', refreshToken: 'refresh-a', userId: 'user-a', revision: 11,
      hydrated: true,
    });
    const socket = new CustomerServiceSocket('access-a', 'wss://test-api.ai-maimai.com');

    const first = socket.connect();
    const second = socket.connect();
    expect(connectSocketMock).toHaveBeenCalledTimes(1);
    resolveSocket(task);
    await Promise.all([first, second]);
    socket.disconnect();
  });

  it.each([
    ['44/cs,{"message":"unauthorized"}', 'connect_error'],
    ['41/cs,', 'disconnect'],
  ])('closes a rejected namespace so a desired connection can recover: %s', async (packet, event) => {
    let onMessage: ((event: { data: string }) => void) | undefined;
    const task = {
      onMessage: vi.fn((handler) => { onMessage = handler; }),
      onError: vi.fn(), onClose: vi.fn(), send: vi.fn(), close: vi.fn(),
    };
    connectSocketMock.mockResolvedValue(task);
    useAuthStore.setState({
      accessToken: 'access-a', refreshToken: 'refresh-a', userId: 'user-a', revision: 13,
      hydrated: true,
    });
    const socket = new CustomerServiceSocket('access-a', 'wss://test-api.ai-maimai.com');
    const handler = vi.fn();
    socket.on(event, handler);
    await socket.connect();

    onMessage?.({ data: packet });

    expect(handler).toHaveBeenCalled();
    expect(task.close).toHaveBeenCalled();
    expect(socket.isConnected()).toBe(false);
    socket.disconnect();
  });
});
