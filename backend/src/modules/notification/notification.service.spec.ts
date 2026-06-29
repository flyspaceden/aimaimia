import { NotFoundException } from '@nestjs/common';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationMessageService } from './notification-message.service';
import { NotificationRegistry } from './notification.registry';
import { NotificationService } from './notification.service';

type OutboxRow = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  idempotencyKey: string;
  payload: unknown;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  attempts: number;
  runAt: Date;
  processingAt: Date | null;
  processedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRow = {
  id: string;
  recipientKind: string;
  recipientKey: string;
  audience: string;
  category: string;
  eventType: string;
  title: string;
  body: string;
  severity: string;
  entityType: string;
  entityId: string;
  action: unknown;
  metadata: unknown;
  idempotencyKey: string;
  readAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

describe('NotificationService and dispatcher', () => {
  const baseEvent = {
    eventType: 'order.shipped',
    aggregateType: 'order',
    aggregateId: 'order-1',
    idempotencyKey: 'order:order-1:shipped',
    actor: { kind: 'system' as const },
    payload: { orderId: 'order-1', buyerUserId: 'buyer-1' },
  };

  const matchesWhere = (row: Record<string, any>, where: Record<string, any> = {}): boolean =>
    Object.entries(where).every(([key, value]): boolean => {
      if (value === null) {
        return row[key] === null;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if ('lte' in value) {
          return row[key] <= value.lte;
        }
        return matchesWhere(row[key] ?? {}, value);
      }
      return row[key] === value;
    });

  const makePrisma = () => {
    const state = { outbox: [] as OutboxRow[], messages: [] as MessageRow[] };

    const notificationOutbox = {
      upsert: jest.fn(async ({ where, create }) => {
        const existing = state.outbox.find((row) => row.idempotencyKey === where.idempotencyKey);
        if (existing) {
          return existing;
        }

        const row: OutboxRow = {
          id: `outbox-${state.outbox.length + 1}`,
          status: 'PENDING',
          attempts: 0,
          runAt: new Date(),
          processingAt: null,
          processedAt: null,
          lastError: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        state.outbox.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where, orderBy, take } = {}) => {
        let rows = state.outbox.filter((row) => matchesWhere(row as any, where as any));
        if (orderBy?.createdAt === 'asc') {
          rows = rows.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        if (typeof take === 'number') {
          rows = rows.slice(0, take);
        }
        return rows;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const rows = state.outbox.filter((row) => matchesWhere(row as any, where as any));
        for (const row of rows) {
          if (data.attempts && typeof data.attempts === 'object' && 'increment' in data.attempts) {
            row.attempts += Number(data.attempts.increment || 0);
          }
          Object.assign(row, { ...data, attempts: row.attempts, updatedAt: new Date() });
        }
        return { count: rows.length };
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = state.outbox.find((item) => item.id === where.id);
        if (!row) {
          throw new Error(`outbox row not found: ${where.id}`);
        }

        if (data.attempts && typeof data.attempts === 'object' && 'increment' in data.attempts) {
          row.attempts += Number(data.attempts.increment || 0);
        }
        Object.assign(row, { ...data, attempts: row.attempts, updatedAt: new Date() });
        return row;
      }),
    };

    const notificationMessage = {
      upsert: jest.fn(async ({ where, create }) => {
        const existing = state.messages.find(
          (row) =>
            row.recipientKey === where.recipientKey_idempotencyKey.recipientKey &&
            row.idempotencyKey === where.recipientKey_idempotencyKey.idempotencyKey,
        );
        if (existing) {
          return existing;
        }

        const row: MessageRow = {
          id: `message-${state.messages.length + 1}`,
          readAt: null,
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        state.messages.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where, orderBy, skip = 0, take } = {}) => {
        let rows = state.messages.filter((row) => matchesWhere(row as any, where as any));
        if (orderBy?.createdAt === 'desc') {
          rows = rows.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        rows = rows.slice(skip);
        if (typeof take === 'number') {
          rows = rows.slice(0, take);
        }
        return rows;
      }),
      count: jest.fn(async ({ where }) =>
        state.messages.filter((row) => matchesWhere(row as any, where as any)).length,
      ),
      findUnique: jest.fn(async ({ where }) => state.messages.find((row) => row.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }) => {
        const row = state.messages.find((item) => item.id === where.id);
        if (!row) {
          throw new Error(`message row not found: ${where.id}`);
        }
        Object.assign(row, { ...data, updatedAt: new Date() });
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const rows = state.messages.filter((row) => matchesWhere(row as any, where as any));
        for (const row of rows) {
          Object.assign(row, { ...data, updatedAt: new Date() });
        }
        return { count: rows.length };
      }),
    };

    return {
      state,
      notificationOutbox,
      notificationMessage,
    };
  };

  it('emits one outbox row per idempotency key and dispatches one recipient message', async () => {
    const prisma = makePrisma();
    const registry = new NotificationRegistry();
    const service = new NotificationService(prisma as any);
    const dispatcher = new NotificationDispatcherService(prisma as any, registry);

    await service.emit(baseEvent);
    await service.emit(baseEvent);

    await dispatcher.dispatchPending(10);

    expect(prisma.state.outbox).toHaveLength(1);
    expect(prisma.state.messages).toHaveLength(1);
    expect(prisma.state.outbox[0].status).toBe('SENT');
  });

  it('uses the supplied tx client for emit', async () => {
    const prisma = makePrisma();
    const txClient = {
      notificationOutbox: {
        upsert: jest.fn(async () => ({ id: 'tx-outbox-1' })),
      },
    };
    const service = new NotificationService(prisma as any);

    await service.emit(baseEvent, txClient as any);

    expect(txClient.notificationOutbox.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.notificationOutbox.upsert).not.toHaveBeenCalled();
  });

  it('skips processing when the CAS claim no longer finds a pending row', async () => {
    const prisma = makePrisma();
    const registry = new NotificationRegistry();
    const dispatcher = new NotificationDispatcherService(prisma as any, registry);

    await prisma.notificationOutbox.upsert({
      where: { idempotencyKey: baseEvent.idempotencyKey },
      create: {
        eventType: baseEvent.eventType,
        aggregateType: baseEvent.aggregateType,
        aggregateId: baseEvent.aggregateId,
        idempotencyKey: baseEvent.idempotencyKey,
        payload: baseEvent,
      },
    });

    prisma.notificationOutbox.updateMany.mockImplementationOnce(async () => ({ count: 0 }));

    await dispatcher.dispatchPending(10);

    expect(prisma.state.messages).toHaveLength(0);
    expect(prisma.state.outbox[0].status).toBe('PENDING');
  });

  it('requeues on a failed attempt and marks FAILED on the fifth attempt', async () => {
    const prisma = makePrisma();
    const registry = { resolve: jest.fn(() => {
      throw new Error('registry boom');
    }) };
    const dispatcher = new NotificationDispatcherService(prisma as any, registry as any);

    await prisma.notificationOutbox.upsert({
      where: { idempotencyKey: 'retry-1' },
      create: {
        eventType: baseEvent.eventType,
        aggregateType: baseEvent.aggregateType,
        aggregateId: baseEvent.aggregateId,
        idempotencyKey: 'retry-1',
        payload: baseEvent,
        attempts: 3,
      },
    });
    prisma.state.outbox[0].attempts = 3;

    await dispatcher.dispatchPending(10);

    expect(prisma.state.outbox[0].attempts).toBe(4);
    expect(prisma.state.outbox[0].status).toBe('PENDING');
    expect(prisma.state.outbox[0].lastError).toBe('registry boom');
    expect(prisma.state.outbox[0].runAt.getTime()).toBeGreaterThan(Date.now());

    prisma.state.outbox[0].status = 'PENDING';
    prisma.state.outbox[0].runAt = new Date(Date.now() - 1000);

    await dispatcher.dispatchPending(10);

    expect(prisma.state.outbox[0].attempts).toBe(5);
    expect(prisma.state.outbox[0].status).toBe('FAILED');
  });

  it('isolates notification messages by recipient and updates read state', async () => {
    const prisma = makePrisma();
    const service = new NotificationMessageService(prisma as any);
    const now = new Date();

    prisma.state.messages.push(
      {
        id: 'message-1',
        recipientKind: 'BUYER_USER',
        recipientKey: 'buyer:1',
        audience: 'BUYER_APP',
        category: 'order',
        eventType: 'order.shipped',
        title: 'm1',
        body: 'body1',
        severity: 'SUCCESS',
        entityType: 'order',
        entityId: 'o1',
        action: { routeKey: 'ORDER_DETAIL', params: { id: 'o1' } },
        metadata: null,
        idempotencyKey: 'id-1',
        readAt: null,
        expiresAt: null,
        createdAt: new Date(now.getTime() - 2000),
        updatedAt: new Date(now.getTime() - 2000),
      },
      {
        id: 'message-2',
        recipientKind: 'BUYER_USER',
        recipientKey: 'buyer:1',
        audience: 'BUYER_APP',
        category: 'order',
        eventType: 'order.shipped',
        title: 'm2',
        body: 'body2',
        severity: 'SUCCESS',
        entityType: 'order',
        entityId: 'o2',
        action: { routeKey: 'ORDER_DETAIL', params: { id: 'o2' } },
        metadata: null,
        idempotencyKey: 'id-2',
        readAt: null,
        expiresAt: null,
        createdAt: new Date(now.getTime() - 1000),
        updatedAt: new Date(now.getTime() - 1000),
      },
      {
        id: 'message-3',
        recipientKind: 'BUYER_USER',
        recipientKey: 'buyer:2',
        audience: 'BUYER_APP',
        category: 'order',
        eventType: 'order.shipped',
        title: 'm3',
        body: 'body3',
        severity: 'SUCCESS',
        entityType: 'order',
        entityId: 'o3',
        action: { routeKey: 'ORDER_DETAIL', params: { id: 'o3' } },
        metadata: null,
        idempotencyKey: 'id-3',
        readAt: null,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      },
    );

    const listed = await service.list('buyer:1');
    expect(listed.map((item) => item.id)).toEqual(['message-2', 'message-1']);
    expect(await service.unreadCount('buyer:1')).toBe(2);
    expect(await service.unreadCount('buyer:2')).toBe(1);

    const afterRead = await service.markRead('buyer:1', 'message-1');
    expect(afterRead.find((item) => item.id === 'message-1')?.unread).toBe(false);
    expect(await service.unreadCount('buyer:1')).toBe(1);

    const afterAllRead = await service.markAllRead('buyer:1');
    expect(afterAllRead.every((item) => item.unread === false)).toBe(true);
    expect(await service.unreadCount('buyer:1')).toBe(0);
    expect(await service.unreadCount('buyer:2')).toBe(1);
    expect(prisma.state.messages.find((item) => item.id === 'message-3')?.readAt).toBeNull();
  });

  it('rejects markRead for another recipients message', async () => {
    const prisma = makePrisma();
    const service = new NotificationMessageService(prisma as any);

    prisma.state.messages.push({
      id: 'message-9',
      recipientKind: 'BUYER_USER',
      recipientKey: 'buyer:2',
      audience: 'BUYER_APP',
      category: 'order',
      eventType: 'order.shipped',
      title: 'm9',
      body: 'body9',
      severity: 'SUCCESS',
      entityType: 'order',
      entityId: 'o9',
      action: null,
      metadata: null,
      idempotencyKey: 'id-9',
      readAt: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.markRead('buyer:1', 'message-9')).rejects.toBeInstanceOf(NotFoundException);
  });
});
