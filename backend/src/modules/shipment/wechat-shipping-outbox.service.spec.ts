import { WechatShippingOutboxService } from './wechat-shipping-outbox.service';
import { WechatMiniProgramApiError } from '../wechat-mini-program-platform/wechat-mini-program-api.service';

function makeMiniSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'checkout-mini-1',
    paymentChannel: 'WECHAT_PAY',
    paymentScene: 'MINI_PROGRAM',
    providerTxnId: '420000000020260802000001',
    miniProgramPayerOpenId: 'openid-locked-at-payment',
    orders: [
      {
        id: 'order-1',
        status: 'SHIPPED',
        addressSnapshot: { phone: '13812345678' },
        items: [
          { companyId: 'company-a', quantity: 2, productSnapshot: { title: '苹果' } },
          { companyId: 'company-b', quantity: 1, productSnapshot: { title: '大米' } },
        ],
        shipments: [
          {
            id: 'shipment-a',
            companyId: 'company-a',
            carrierCode: 'SF',
            trackingNo: 'legacy-tracking-a',
            waybillNo: 'SF1234567890',
            status: 'IN_TRANSIT',
            shippedAt: new Date('2026-08-02T12:00:00.000Z'),
            receiverInfoSnapshot: { tel: '13812345678' },
          },
          {
            id: 'shipment-b',
            companyId: 'company-b',
            carrierCode: 'ZTO',
            trackingNo: 'ZTO1234567890',
            waybillNo: null,
            status: 'INIT',
            shippedAt: null,
            receiverInfoSnapshot: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makePrisma() {
  return {
    wechatShippingOutbox: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    checkoutSession: {
      findUnique: jest.fn(),
    },
  };
}

async function readySnapshot(
  service: WechatShippingOutboxService,
  prisma: ReturnType<typeof makePrisma>,
  session: ReturnType<typeof makeMiniSession>,
) {
  prisma.checkoutSession.findUnique.mockResolvedValue(session);
  const snapshot = await (service as any).buildSnapshotForCheckoutSession(prisma, session.id);
  if (snapshot.kind !== 'READY') throw new Error(`expected READY, received ${snapshot.kind}`);
  return snapshot;
}

describe('WechatShippingOutboxService', () => {
  it('aggregates a multi-company payment into split delivery and prefers waybillNo', async () => {
    const prisma = makePrisma();
    const wechatApi = { postJson: jest.fn() };
    const service = new WechatShippingOutboxService(prisma as any, wechatApi as any);
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({ checkoutSessionId: 'checkout-mini-1' }),
      },
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(makeMiniSession()),
      },
      wechatShippingOutbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
      },
    };

    await expect(service.enqueueForOrderTx(tx as any, 'order-1')).resolves.toEqual({
      enqueued: true,
    });
    const upsert = tx.wechatShippingOutbox.upsert.mock.calls[0][0];
    const payload = upsert.create.payload;
    expect(payload).toEqual(expect.objectContaining({
      delivery_mode: 2,
      is_all_delivered: false,
      logistics_type: 1,
      order_key: {
        order_number_type: 2,
        transaction_id: '420000000020260802000001',
      },
    }));
    expect(payload.shipping_list).toEqual([
      expect.objectContaining({
        tracking_no: 'SF1234567890',
        express_company: 'SF',
        item_desc: '苹果*2件',
        contact: { receiver_contact: '138****5678' },
      }),
    ]);
    expect(payload).not.toHaveProperty('payer');
  });

  it.each([
    ['ALIPAY', 'MINI_PROGRAM'],
    ['WECHAT_PAY', 'APP'],
  ])('does not enqueue %s/%s payments', async (paymentChannel, paymentScene) => {
    const prisma = makePrisma();
    const service = new WechatShippingOutboxService(prisma as any, { postJson: jest.fn() } as any);
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({ checkoutSessionId: 'checkout-1' }),
      },
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(makeMiniSession({ paymentChannel, paymentScene })),
      },
      wechatShippingOutbox: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    await expect(service.enqueueForOrderTx(tx as any, 'order-1')).resolves.toEqual({
      enqueued: false,
      reason: 'NOT_MINI_PROGRAM_WECHAT_PAYMENT',
    });
    expect(tx.wechatShippingOutbox.upsert).not.toHaveBeenCalled();
  });

  it('sends with the payer OpenID locked on CheckoutSession and closes by generation CAS', async () => {
    const prisma = makePrisma();
    const wechatApi = { postJson: jest.fn().mockResolvedValue({ errcode: 0, errmsg: 'ok' }) };
    const service = new WechatShippingOutboxService(prisma as any, wechatApi as any);
    const snapshot = await readySnapshot(service, prisma, makeMiniSession());
    prisma.wechatShippingOutbox.findMany.mockResolvedValue([{ id: 'outbox-1', generation: 7 }]);
    prisma.wechatShippingOutbox.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.wechatShippingOutbox.findFirst.mockResolvedValue({
      id: 'outbox-1',
      checkoutSessionId: 'checkout-mini-1',
      generation: 7,
      payloadHash: snapshot.payloadHash,
      payload: snapshot.payload,
      attemptCount: 0,
    });

    await service.processPendingBatch();

    expect(wechatApi.postJson).toHaveBeenCalledWith(
      '/wxa/sec/order/upload_shipping_info',
      expect.objectContaining({
        payer: { openid: 'openid-locked-at-payment' },
        order_key: snapshot.payload.order_key,
        shipping_list: snapshot.payload.shipping_list,
      }),
    );
    const successCas = prisma.wechatShippingOutbox.updateMany.mock.calls[1][0];
    expect(successCas.where).toEqual(expect.objectContaining({
      id: 'outbox-1',
      generation: 7,
      status: 'PROCESSING',
      leaseToken: expect.any(String),
    }));
    expect(successCas.data.status).toBe('SUCCEEDED');
  });

  it('persists a failed outbox instead of sending with a missing payment OpenID', async () => {
    const prisma = makePrisma();
    const service = new WechatShippingOutboxService(prisma as any, { postJson: jest.fn() } as any);
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({ checkoutSessionId: 'checkout-mini-1' }),
      },
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(makeMiniSession({ miniProgramPayerOpenId: null })),
      },
      wechatShippingOutbox: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'outbox-invalid' }),
      },
    };

    await expect(service.enqueueForOrderTx(tx as any, 'order-1')).resolves.toEqual({
      enqueued: false,
      reason: 'PAYER_OPENID_MISSING',
    });
    expect(tx.wechatShippingOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        status: 'FAILED',
        lastErrorCode: 'PAYER_OPENID_MISSING',
      }),
    }));
  });

  it('manual retry rebuilds the current snapshot and force-resets an unchanged failed outbox', async () => {
    const prisma = makePrisma() as any;
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({ checkoutSessionId: 'checkout-mini-1' }),
      },
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(makeMiniSession()),
      },
      wechatShippingOutbox: {
        findUnique: jest.fn().mockResolvedValue({ payloadHash: 'same-hash' }),
        upsert: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
      },
    };
    prisma.$transaction = jest.fn((callback: any) => callback(tx));
    const service = new WechatShippingOutboxService(
      prisma,
      { postJson: jest.fn() } as any,
    );

    await expect(service.retryForOrder('order-1')).resolves.toEqual({ enqueued: true });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.wechatShippingOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        status: 'PENDING',
        attemptCount: 0,
        lastError: null,
        lastErrorCode: null,
      }),
    }));
  });

  it('releases the lease and schedules a backoff retry for transient platform failures', async () => {
    const prisma = makePrisma();
    const service = new WechatShippingOutboxService(
      prisma as any,
      { postJson: jest.fn().mockRejectedValue(new Error('network down')) } as any,
    );
    const session = makeMiniSession({
      id: 'checkout-mini-2',
      providerTxnId: 'wx-txn-1',
      miniProgramPayerOpenId: 'locked-openid',
    });
    const snapshot = await readySnapshot(service, prisma, session);
    prisma.wechatShippingOutbox.findMany.mockResolvedValue([{ id: 'outbox-2', generation: 3 }]);
    prisma.wechatShippingOutbox.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.wechatShippingOutbox.findFirst.mockResolvedValue({
      id: 'outbox-2',
      checkoutSessionId: 'checkout-mini-2',
      generation: 3,
      payloadHash: snapshot.payloadHash,
      payload: snapshot.payload,
      attemptCount: 0,
    });

    await service.processPendingBatch();

    const retryCas = prisma.wechatShippingOutbox.updateMany.mock.calls[1][0];
    expect(retryCas.where).toEqual(expect.objectContaining({
      id: 'outbox-2',
      generation: 3,
      status: 'PROCESSING',
      leaseToken: expect.any(String),
    }));
    expect(retryCas.data).toEqual(expect.objectContaining({
      status: 'PENDING',
      attemptCount: { increment: 1 },
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: 'TRANSIENT_ERROR',
      nextAttemptAt: expect.any(Date),
    }));
  });

  it('fails closed without calling WeChat when the queued shipment was refunded before delivery', async () => {
    const prisma = makePrisma();
    const wechatApi = { postJson: jest.fn() };
    const service = new WechatShippingOutboxService(prisma as any, wechatApi as any);
    const activeSession = makeMiniSession();
    const snapshot = await readySnapshot(service, prisma, activeSession);
    const refundedSession = makeMiniSession({
      orders: activeSession.orders.map((order) => ({ ...order, status: 'REFUNDED' })),
    });
    prisma.checkoutSession.findUnique.mockResolvedValue(refundedSession);
    prisma.wechatShippingOutbox.findMany.mockResolvedValue([{ id: 'outbox-stale', generation: 2 }]);
    prisma.wechatShippingOutbox.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.wechatShippingOutbox.findFirst.mockResolvedValue({
      id: 'outbox-stale',
      checkoutSessionId: activeSession.id,
      generation: 2,
      payloadHash: snapshot.payloadHash,
      payload: snapshot.payload,
      attemptCount: 0,
    });

    await service.processPendingBatch();

    expect(wechatApi.postJson).not.toHaveBeenCalled();
    expect(prisma.wechatShippingOutbox.updateMany.mock.calls[1][0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        id: 'outbox-stale',
        generation: 2,
        status: 'PROCESSING',
        leaseToken: expect.any(String),
      }),
      data: expect.objectContaining({
        status: 'FAILED',
        lastErrorCode: 'STALE_SHIPPING_SNAPSHOT',
      }),
    }));
  });

  it('rebuilds a changed authoritative snapshot under generation CAS before any remote send', async () => {
    const prisma = makePrisma();
    const wechatApi = { postJson: jest.fn() };
    const service = new WechatShippingOutboxService(prisma as any, wechatApi as any);
    const oldSession = makeMiniSession();
    const oldSnapshot = await readySnapshot(service, prisma, oldSession);
    const changedSession = makeMiniSession({
      orders: oldSession.orders.map((order) => ({
        ...order,
        shipments: order.shipments.map((shipment) => shipment.id === 'shipment-b'
          ? { ...shipment, status: 'SHIPPED', shippedAt: new Date('2026-08-02T12:05:00.000Z') }
          : shipment),
      })),
    });
    prisma.checkoutSession.findUnique.mockResolvedValue(changedSession);
    prisma.wechatShippingOutbox.findMany.mockResolvedValue([{ id: 'outbox-changed', generation: 4 }]);
    prisma.wechatShippingOutbox.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.wechatShippingOutbox.findFirst.mockResolvedValue({
      id: 'outbox-changed',
      checkoutSessionId: oldSession.id,
      generation: 4,
      payloadHash: oldSnapshot.payloadHash,
      payload: oldSnapshot.payload,
      attemptCount: 1,
    });

    await service.processPendingBatch();

    expect(wechatApi.postJson).not.toHaveBeenCalled();
    const replaceCas = prisma.wechatShippingOutbox.updateMany.mock.calls[1][0];
    expect(replaceCas.where).toEqual(expect.objectContaining({
      id: 'outbox-changed',
      generation: 4,
      status: 'PROCESSING',
      leaseToken: expect.any(String),
    }));
    expect(replaceCas.data).toEqual(expect.objectContaining({
      status: 'PENDING',
      generation: { increment: 1 },
      attemptCount: 0,
      lastErrorCode: 'STALE_SNAPSHOT_REBUILT',
    }));
    expect(replaceCas.data.payloadHash).not.toBe(oldSnapshot.payloadHash);
  });

  it.each([10060002, 10060003])(
    'treats WeChat shipping error %s as a permanent failure instead of false success',
    async (errcode) => {
      const prisma = makePrisma();
      const wechatApi = {
        postJson: jest.fn().mockRejectedValue(new WechatMiniProgramApiError(errcode, 'rejected')),
      };
      const service = new WechatShippingOutboxService(prisma as any, wechatApi as any);
      const session = makeMiniSession();
      const snapshot = await readySnapshot(service, prisma, session);
      prisma.wechatShippingOutbox.findMany.mockResolvedValue([{ id: `outbox-${errcode}`, generation: 1 }]);
      prisma.wechatShippingOutbox.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });
      prisma.wechatShippingOutbox.findFirst.mockResolvedValue({
        id: `outbox-${errcode}`,
        checkoutSessionId: session.id,
        generation: 1,
        payloadHash: snapshot.payloadHash,
        payload: snapshot.payload,
        attemptCount: 0,
      });

      await service.processPendingBatch();

      const terminalCas = prisma.wechatShippingOutbox.updateMany.mock.calls[1][0];
      expect(terminalCas.data).toEqual(expect.objectContaining({
        status: 'FAILED',
        lastErrorCode: String(errcode),
      }));
      expect(terminalCas.data.status).not.toBe('SUCCEEDED');
    },
  );
});
