import { BonusController } from './bonus.controller';

describe('BonusController WeChat transfer callback', () => {
  const rawBody = '{"event_type":"MCHTRANSFER.BILL.FINISHED","resource":{"ciphertext":"signed"}}';
  const headers = {
    'wechatpay-signature': 'signature',
    'wechatpay-timestamp': '1785715200',
    'wechatpay-nonce': 'nonce',
    'wechatpay-serial': 'PUB_KEY_ID_123',
  };
  const notify = {
    eventId: 'event-1',
    outBillNo: 'WX123456789012345678901234567890',
    transferBillNo: 'wx-transfer-1',
    state: 'SUCCESS',
    mchId: '1900000109',
    openId: 'openid-session-bound',
    amountFen: 8_000,
  };

  const build = (overrides: { parseError?: Error; handleError?: Error } = {}) => {
    const payout = {
      requestWithdraw: jest.fn(),
      enqueueWechatTransferNotify: overrides.handleError
        ? jest.fn().mockRejectedValue(overrides.handleError)
        : jest.fn().mockResolvedValue('event-1'),
      processWechatTransferNotifyInbox: jest.fn().mockResolvedValue(undefined),
    };
    const provider = {
      parseNotify: overrides.parseError
        ? jest.fn(() => { throw overrides.parseError; })
        : jest.fn().mockReturnValue(notify),
    };
    const controller = new BonusController({} as any, payout as any, provider as any);
    const res: any = {
      status: jest.fn(),
      send: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return { controller, payout, provider, res };
  };

  it('passes the exact raw body and Wechatpay headers to verification, then acks 204', async () => {
    const { controller, payout, provider, res } = build();
    const parsedBody = { resource: { ciphertext: 'signed' } };

    await controller.handleWechatTransferNotify(
      parsedBody,
      { rawBody: Buffer.from(rawBody) } as any,
      headers,
      res,
    );

    expect(provider.parseNotify).toHaveBeenCalledWith({
      body: parsedBody,
      rawBody,
      headers: {
        signature: 'signature',
        timestamp: '1785715200',
        nonce: 'nonce',
        serial: 'PUB_KEY_ID_123',
      },
    });
    expect(payout.enqueueWechatTransferNotify).toHaveBeenCalledWith(notify);
    expect(payout.processWechatTransferNotifyInbox).toHaveBeenCalledWith('event-1');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('rejects missing rawBody before parsing', async () => {
    const { controller, payout, provider, res } = build();
    await controller.handleWechatTransferNotify({}, {} as any, headers, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(provider.parseNotify).not.toHaveBeenCalled();
    expect(payout.enqueueWechatTransferNotify).not.toHaveBeenCalled();
  });

  it('acks after durable enqueue without waiting for provider query processing', async () => {
    const { controller, payout, res } = build();
    payout.processWechatTransferNotifyInbox.mockReturnValue(new Promise(() => undefined));

    await controller.handleWechatTransferNotify(
      {}, { rawBody } as any, headers, res,
    );

    expect(payout.enqueueWechatTransferNotify).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns 401 for signature/decryption failures and 500 for retriable state handling failures', async () => {
    const invalid = build({ parseError: new Error('bad signature') });
    await invalid.controller.handleWechatTransferNotify(
      {}, { rawBody } as any, headers, invalid.res,
    );
    expect(invalid.res.status).toHaveBeenCalledWith(401);

    const retry = build({ handleError: new Error('query unavailable') });
    await retry.controller.handleWechatTransferNotify(
      {}, { rawBody } as any, headers, retry.res,
    );
    expect(retry.res.status).toHaveBeenCalledWith(500);
  });
});
