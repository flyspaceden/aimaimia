import Taro from '@tarojs/taro';
import { WS_BASE_URL } from '@/api/config';
import { captureAuthSession, useAuthStore } from '@/store/auth';

type SocketEventHandler<T = unknown> = (payload: T) => void;

const ENGINE_OPEN = '0';
const ENGINE_PING = '2';
const ENGINE_PONG = '3';
const SOCKET_CONNECT = '40';
const SOCKET_DISCONNECT = '41';
const SOCKET_EVENT = '42';
const SOCKET_CONNECT_ERROR = '44';

/**
 * 使用微信 SocketTask 实现最小 Engine.IO v4 + Socket.IO namespace 协议。
 * 客服消息正文仍由现有 REST 落库，该连接只承担房间事件和实时增量；断线时页面必须回退 REST 补拉。
 */
export class CustomerServiceSocket {
  private readonly namespace = '/cs';
  private readonly handlers = new Map<string, Set<SocketEventHandler>>();
  private readonly queuedPackets: string[] = [];
  private socket: Taro.SocketTask | null = null;
  private desired = false;
  private namespaceConnected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectFlight: Promise<void> | null = null;
  private readonly authRevision: number;
  private readonly unsubscribeAuth: () => void;
  private disposed = false;

  constructor(
    private readonly token: string,
    private readonly baseUrl = WS_BASE_URL,
  ) {
    this.authRevision = captureAuthSession().revision;
    this.unsubscribeAuth = useAuthStore.subscribe((state) => {
      if (state.revision !== this.authRevision || state.accessToken !== this.token) {
        this.disconnect();
      }
    });
  }

  on<T = unknown>(event: string, handler: SocketEventHandler<T>): () => void {
    const handlers = this.handlers.get(event) || new Set<SocketEventHandler>();
    handlers.add(handler as SocketEventHandler);
    this.handlers.set(event, handlers);
    return () => {
      handlers.delete(handler as SocketEventHandler);
      if (handlers.size === 0) this.handlers.delete(event);
    };
  }

  connect(): Promise<void> {
    if (this.connectFlight) return this.connectFlight;
    if (this.socket || !this.token || this.disposed) return Promise.resolve();
    if (!this.hasCurrentAuthGeneration()) {
      this.disconnect();
      return Promise.resolve();
    }
    this.desired = true;
    const flight = this.openSocket();
    this.connectFlight = flight.finally(() => {
      if (this.connectFlight === flight || this.connectFlight === wrappedFlight) {
        this.connectFlight = null;
      }
    });
    const wrappedFlight = this.connectFlight;
    return wrappedFlight;
  }

  private async openSocket(): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/socket.io/?EIO=4&transport=websocket&t=${Date.now()}`;
    try {
      const socket = await Taro.connectSocket({ url });
      if (!this.desired) {
        socket.close({ code: 1000, reason: 'client stopped' });
        return;
      }
      this.socket = socket;
      socket.onMessage(({ data }) => {
        if (this.socket === socket) this.handlePacket(data);
      });
      socket.onError((error) => {
        if (this.socket === socket) this.emitLocal('connect_error', error);
      });
      socket.onClose(() => this.handleClose(socket));
    } catch (error) {
      this.emitLocal('connect_error', error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.desired = false;
    this.namespaceConnected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      this.sendRaw(`${SOCKET_DISCONNECT}${this.namespace},`);
      this.socket.close({ code: 1000, reason: 'client disconnect' });
      this.socket = null;
    }
    this.queuedPackets.length = 0;
    this.handlers.clear();
    this.unsubscribeAuth();
  }

  emit(event: string, payload?: unknown): void {
    if (this.disposed || !this.hasCurrentAuthGeneration()) return;
    const packet = `${SOCKET_EVENT}${this.namespace},${JSON.stringify([event, payload])}`;
    if (!this.namespaceConnected) {
      this.queuedPackets.push(packet);
      return;
    }
    this.sendRaw(packet);
  }

  isConnected(): boolean {
    return this.namespaceConnected;
  }

  private handlePacket(data: string | ArrayBuffer): void {
    if (this.disposed || !this.hasCurrentAuthGeneration()) return;
    if (typeof data !== 'string') return;
    if (data.startsWith(ENGINE_OPEN)) {
      this.sendRaw(`${SOCKET_CONNECT}${this.namespace},${JSON.stringify({ token: this.token })}`);
      return;
    }
    if (data === ENGINE_PING || data.startsWith(ENGINE_PING)) {
      this.sendRaw(`${ENGINE_PONG}${data.slice(1)}`);
      return;
    }
    if (data.startsWith(`${SOCKET_CONNECT}${this.namespace},`)) {
      this.namespaceConnected = true;
      this.reconnectAttempt = 0;
      this.queuedPackets.splice(0).forEach((packet) => this.sendRaw(packet));
      this.emitLocal('connect', undefined);
      return;
    }
    if (data.startsWith(`${SOCKET_DISCONNECT}${this.namespace}`)) {
      this.emitLocal('disconnect', undefined);
      this.restartConnection('namespace disconnected');
      return;
    }
    if (data.startsWith(`${SOCKET_CONNECT_ERROR}${this.namespace},`)) {
      this.emitLocal('connect_error', this.parseJson(data.split(',').slice(1).join(',')));
      this.restartConnection('namespace authentication failed');
      return;
    }
    const eventPrefix = `${SOCKET_EVENT}${this.namespace},`;
    if (!data.startsWith(eventPrefix)) return;

    // Socket.IO 可在 namespace 后带 ack id；客服当前事件不使用 ack，但解析时要兼容。
    const encoded = data.slice(eventPrefix.length).replace(/^\d+/, '');
    const decoded = this.parseJson(encoded);
    if (!Array.isArray(decoded) || typeof decoded[0] !== 'string') return;
    this.emitLocal(decoded[0], decoded[1]);
  }

  private handleClose(closedSocket: Taro.SocketTask): void {
    if (this.socket !== closedSocket) return;
    const wasConnected = this.namespaceConnected;
    this.socket = null;
    this.namespaceConnected = false;
    if (wasConnected) this.emitLocal('disconnect', undefined);
    this.scheduleReconnect();
  }

  private restartConnection(reason: string): void {
    const socket = this.socket;
    this.socket = null;
    this.namespaceConnected = false;
    socket?.close({ code: 1000, reason });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.desired || this.disposed || this.reconnectTimer) return;
    const delay = Math.min(500 * (2 ** this.reconnectAttempt), 5_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private sendRaw(data: string): void {
    this.socket?.send({
      data,
      fail: (error) => this.emitLocal('connect_error', error),
    });
  }

  private parseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private emitLocal(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }

  private hasCurrentAuthGeneration(): boolean {
    const state = useAuthStore.getState();
    return state.revision === this.authRevision && state.accessToken === this.token;
  }
}
