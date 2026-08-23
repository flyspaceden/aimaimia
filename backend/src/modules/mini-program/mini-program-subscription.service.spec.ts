import { BadRequestException } from '@nestjs/common';
import { MiniProgramSubscriptionService } from './mini-program-subscription.service';

const env: Record<string, string> = {
  WECHAT_MINIAPP_SUBSCRIBE_ORDER_SHIPPED_TEMPLATE_ID: 'tmpl-order',
  WECHAT_MINIAPP_SUBSCRIBE_ORDER_SHIPPED_FIELDS: JSON.stringify({
    reference: 'character_string1', status: 'phrase2', remark: 'thing3', time: 'time4',
  }),
};

function harness() {
  const prisma: any = {
    authIdentity: { findFirst: jest.fn() },
    miniProgramSubscriptionConsent: {
      upsert: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(),
    },
    miniProgramSubscriptionOutbox: {
      findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(),
    },
    withdrawRequest: { findUnique: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(prisma));
  const config = { get: jest.fn((key: string, fallback?: string) => key in env ? env[key as keyof typeof env] : fallback) };
  const wechat = {
    isAvailable: jest.fn().mockReturnValue(true),
    getAppId: jest.fn().mockReturnValue('wx-mini'),
    postJson: jest.fn().mockResolvedValue({ errcode: 0 }),
  };
  return {
    prisma,
    config,
    wechat,
    service: new MiniProgramSubscriptionService(prisma, config as any, wechat as any),
  };
}

const event: any = {
  eventType: 'order.shipped',
  aggregateType: 'order',
  aggregateId: 'order-12345678901234567890',
  idempotencyKey: 'order:1:shipped',
  actor: { kind: 'seller' },
  payload: { orderId: 'order-12345678901234567890', buyerUserId: 'user-1' },
};

const message: any = {
  recipientKind: 'BUYER_USER', recipientKey: 'user-1', audience: 'BUYER_APP',
  category: 'order', eventType: 'order.shipped', title: '订单已发货',
  body: '您的订单已发货，可查看物流进度。', severity: 'SUCCESS',
  entityType: 'order', entityId: 'order-12345678901234567890',
  action: { routeKey: 'ORDER_DETAIL', params: { id: 'order-12345678901234567890' } },
  idempotencyKey: 'order:1:shipped:user-1',
};

describe('MiniProgramSubscriptionService', () => {
  it('maps the legacy staging value develop to the WeChat developer state', () => {
    env.WECHAT_MINIAPP_SUBSCRIBE_STATE = 'develop';
    const { service } = harness();
    expect((service as any).miniProgramState()).toBe('developer');
    delete env.WECHAT_MINIAPP_SUBSCRIBE_STATE;
  });

  it('only records a consent for the exact verified mini-program auth identity', async () => {
    const { service, prisma } = harness();
    prisma.authIdentity.findFirst.mockResolvedValue(null);
    await expect(service.recordConsents('user-1', {
      sessionId: 'session-1', authIdentityId: 'identity-other',
    }, {
      clientRequestId: 'mini-sub-request-001',
      results: [{ key: 'ORDER_SHIPPED', templateId: 'tmpl-order', status: 'accept' }],
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.authIdentity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'identity-other', userId: 'user-1', appId: 'wx-mini', verified: true }),
    }));
    expect(prisma.miniProgramSubscriptionConsent.upsert).not.toHaveBeenCalled();
  });

  it('records an accepted one-time grant idempotently', async () => {
    const { service, prisma } = harness();
    prisma.authIdentity.findFirst.mockResolvedValue({ id: 'identity-1' });
    prisma.miniProgramSubscriptionConsent.upsert.mockResolvedValue({ id: 'consent-1' });
    await expect(service.recordConsents('user-1', {
      sessionId: 'session-1', authIdentityId: 'identity-1',
    }, {
      clientRequestId: 'mini-sub-request-001',
      results: [{ key: 'ORDER_SHIPPED', templateId: 'tmpl-order', status: 'accept' }],
    })).resolves.toEqual({ recorded: 1 });
    expect(prisma.miniProgramSubscriptionConsent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_clientRequestId_templateKey: { userId: 'user-1', clientRequestId: 'mini-sub-request-001', templateKey: 'ORDER_SHIPPED' } },
      create: expect.objectContaining({ status: 'ACCEPTED', authIdentityId: 'identity-1' }),
    }));
  });

  it('atomically reserves one accepted grant for one notification event', async () => {
    const { service, prisma } = harness();
    prisma.miniProgramSubscriptionOutbox.findUnique.mockResolvedValue(null);
    prisma.miniProgramSubscriptionConsent.findFirst.mockResolvedValue({ id: 'consent-1' });
    prisma.miniProgramSubscriptionOutbox.create.mockResolvedValue({ id: 'outbox-1', status: 'PENDING' });
    prisma.miniProgramSubscriptionConsent.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.enqueueFromNotification(event, message)).resolves.toMatchObject({ id: 'outbox-1' });
    expect(prisma.miniProgramSubscriptionOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        consentId: 'consent-1', status: 'PENDING', templateId: 'tmpl-order',
        page: expect.stringContaining('packages/orders/order-detail/index?id='),
      }),
    });
    expect(prisma.miniProgramSubscriptionConsent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'consent-1', reservedOutboxId: null, consumedAt: null }),
      data: expect.objectContaining({ reservedOutboxId: 'outbox-1' }),
    }));
  });

  it('writes an auditable skipped outbox when no one-time grant exists', async () => {
    const { service, prisma } = harness();
    prisma.miniProgramSubscriptionOutbox.findUnique.mockResolvedValue(null);
    prisma.miniProgramSubscriptionConsent.findFirst.mockResolvedValue(null);
    prisma.miniProgramSubscriptionOutbox.create.mockResolvedValue({ id: 'outbox-skip', status: 'SKIPPED' });
    await service.enqueueFromNotification(event, message);
    expect(prisma.miniProgramSubscriptionOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SKIPPED', lastErrorCode: 'NO_ACCEPTED_CONSENT' }),
    });
  });

  it('uses the authoritative withdrawal request time for the withdrawal template', async () => {
    const { service, prisma } = harness();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      createdAt: new Date('2026-08-11T12:34:00.000Z'),
    });
    const eventTime = await (service as any).resolveEventTime({
      ...event,
      eventType: 'withdraw.paid',
      aggregateId: 'withdraw-1',
      payload: {},
    });
    const data = (service as any).buildWechatData(
      { status: 'phrase2', remark: 'thing4', time: 'time3' },
      {
        ...event,
        eventType: 'withdraw.paid',
        aggregateId: 'withdraw-1',
        payload: {},
      },
      { ...message, body: '提现金额已转入申请的收款账户' },
      eventTime,
    );

    expect(data).toEqual({
      phrase2: { value: '已到账' },
      thing4: { value: '提现金额已转入申请的收款账户' },
      time3: { value: '2026-08-11 20:34' },
    });
    expect(prisma.withdrawRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'withdraw-1' },
      select: { createdAt: true },
    });
  });

  it('retries a unique conflict and returns the concurrently created idempotent outbox', async () => {
    const { service, prisma } = harness();
    prisma.miniProgramSubscriptionOutbox.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'outbox-concurrent', status: 'PENDING' });
    prisma.miniProgramSubscriptionConsent.findFirst.mockResolvedValue({ id: 'consent-1' });
    prisma.miniProgramSubscriptionOutbox.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(service.enqueueFromNotification(event, message)).resolves.toEqual({
      id: 'outbox-concurrent',
      status: 'PENDING',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('sends to the openid from the reserved consent identity and consumes it after success', async () => {
    const { service, prisma, wechat } = harness();
    const row = {
      id: 'outbox-1', status: 'PENDING', attempts: 0, runAt: new Date(), updatedAt: new Date(),
      consentId: 'consent-1', userId: 'user-1', templateId: 'tmpl-order',
      page: 'packages/orders/order-detail/index?id=order-1', data: { phrase2: { value: '已发货' } },
    };
    prisma.miniProgramSubscriptionOutbox.updateMany.mockResolvedValue({ count: 1 });
    prisma.miniProgramSubscriptionConsent.findUnique.mockResolvedValue({
      id: 'consent-1', authIdentityId: 'identity-1', appId: 'wx-mini',
      reservedOutboxId: 'outbox-1', consumedAt: null, status: 'ACCEPTED',
    });
    prisma.authIdentity.findFirst.mockResolvedValue({ identifier: 'openid-locked' });
    prisma.miniProgramSubscriptionConsent.updateMany.mockResolvedValue({ count: 1 });

    await (service as any).dispatchOne(row);
    expect(wechat.postJson).toHaveBeenCalledWith('/cgi-bin/message/subscribe/send', expect.objectContaining({
      touser: 'openid-locked', template_id: 'tmpl-order', miniprogram_state: 'formal',
    }));
    expect(prisma.miniProgramSubscriptionConsent.updateMany).toHaveBeenCalledWith({
      where: { reservedOutboxId: 'outbox-1', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('terminally fails and consumes a reserved grant after the fifth uncertain send', async () => {
    const { service, prisma, wechat } = harness();
    const row = {
      id: 'outbox-5', status: 'PENDING', attempts: 4, runAt: new Date(), updatedAt: new Date(),
      consentId: 'consent-5', userId: 'user-1', templateId: 'tmpl-order',
      page: 'packages/orders/order-detail/index?id=order-1', data: {},
    };
    prisma.miniProgramSubscriptionOutbox.updateMany.mockResolvedValue({ count: 1 });
    prisma.miniProgramSubscriptionConsent.findUnique.mockResolvedValue({
      id: 'consent-5', authIdentityId: 'identity-1', appId: 'wx-mini',
      reservedOutboxId: 'outbox-5', consumedAt: null, status: 'ACCEPTED',
    });
    prisma.authIdentity.findFirst.mockResolvedValue({ identifier: 'openid-locked' });
    prisma.miniProgramSubscriptionConsent.updateMany.mockResolvedValue({ count: 1 });
    wechat.postJson.mockRejectedValue(new Error('timeout'));

    await (service as any).dispatchOne(row);

    expect(prisma.miniProgramSubscriptionOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'outbox-5', status: 'PROCESSING', processingAt: expect.any(Date) },
      data: expect.objectContaining({ status: 'FAILED', processedAt: expect.any(Date), lastErrorCode: 'UPSTREAM_ERROR' }),
    });
    expect(prisma.miniProgramSubscriptionConsent.updateMany).toHaveBeenCalledWith({
      where: { reservedOutboxId: 'outbox-5', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });
});
