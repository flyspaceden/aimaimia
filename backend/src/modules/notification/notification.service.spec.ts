import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationRegistry } from './notification.registry';
import { NotificationService } from './notification.service';

describe('NotificationService and dispatcher', () => {
  const makePrisma = () => {
    const state = { outbox: [] as any[], messages: [] as any[] };

    return {
      state,
      notificationOutbox: {
        upsert: jest.fn(async ({ where, create }) => {
          const existing = state.outbox.find((row) => row.idempotencyKey === where.idempotencyKey);
          if (existing) return existing;

          const row = {
            id: `outbox-${state.outbox.length + 1}`,
            status: 'PENDING',
            attempts: 0,
            runAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          };
          state.outbox.push(row);
          return row;
        }),
        findMany: jest.fn(async () => state.outbox.filter((row) => row.status === 'PENDING')),
        update: jest.fn(async ({ where, data }) => {
          const row = state.outbox.find((item) => item.id === where.id);
          if (!row) {
            throw new Error(`outbox row not found: ${where.id}`);
          }

          const nextData =
            typeof data.attempts === 'object' && data.attempts && 'increment' in data.attempts
              ? { ...data, attempts: row.attempts + Number(data.attempts.increment || 0) }
              : data;

          Object.assign(row, nextData, { updatedAt: new Date() });
          return row;
        }),
      },
      notificationMessage: {
        upsert: jest.fn(async ({ where, create }) => {
          const existing = state.messages.find(
            (row) =>
              row.recipientKey === where.recipientKey_idempotencyKey.recipientKey &&
              row.idempotencyKey === where.recipientKey_idempotencyKey.idempotencyKey,
          );
          if (existing) return existing;

          const row = {
            id: `message-${state.messages.length + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          };
          state.messages.push(row);
          return row;
        }),
      },
    };
  };

  it('emits one outbox row per idempotency key and dispatches one recipient message', async () => {
    const prisma = makePrisma();
    const registry = new NotificationRegistry();
    const service = new NotificationService(prisma as any);
    const dispatcher = new NotificationDispatcherService(prisma as any, registry);

    await service.emit({
      eventType: 'order.shipped',
      aggregateType: 'order',
      aggregateId: 'order-1',
      idempotencyKey: 'order:order-1:shipped',
      actor: { kind: 'system' },
      payload: { orderId: 'order-1', buyerUserId: 'buyer-1' },
    });
    await service.emit({
      eventType: 'order.shipped',
      aggregateType: 'order',
      aggregateId: 'order-1',
      idempotencyKey: 'order:order-1:shipped',
      actor: { kind: 'system' },
      payload: { orderId: 'order-1', buyerUserId: 'buyer-1' },
    });

    await dispatcher.dispatchPending(10);

    expect(prisma.state.outbox).toHaveLength(1);
    expect(prisma.state.messages).toHaveLength(1);
    expect(prisma.state.outbox[0].status).toBe('SENT');
  });
});
