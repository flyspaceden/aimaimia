import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createSign,
  generateKeyPairSync,
} from 'crypto';
import { WechatMerchantTransferService } from './wechat-merchant-transfer.service';

describe('WechatMerchantTransferService', () => {
  const originalFetch = global.fetch;
  const merchantKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wechatKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const merchantPrivateKey = merchantKeys.privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }).toString();
  const wechatPublicKey = wechatKeys.publicKey.export({
    type: 'spki',
    format: 'pem',
  }).toString();
  const apiV3Key = '12345678901234567890123456789012';
  const publicKeyId = 'PUB_KEY_ID_1234567890';
  const baseConfig: Record<string, string> = {
    WECHAT_TRANSFER_ENABLED: 'true',
    WECHAT_MINIAPP_APP_ID: 'wx-mini-app',
    WECHAT_PAY_MCH_ID: '1900000109',
    WECHAT_PAY_API_V3_KEY: apiV3Key,
    WECHAT_PAY_MERCHANT_CERT_SERIAL: 'MERCHANT_CERT_SERIAL',
    WECHAT_PAY_MERCHANT_PRIVATE_KEY: merchantPrivateKey,
    WECHAT_PAY_PUBLIC_KEY_ID: publicKeyId,
    WECHAT_PAY_PUBLIC_KEY: wechatPublicKey,
    WECHAT_TRANSFER_NOTIFY_URL: 'https://api.ai-maimai.com/api/v1/bonus/withdraw/wechat/notify',
    WECHAT_TRANSFER_SCENE_ID: '1005',
    WECHAT_TRANSFER_REMARK: 'AI爱买买佣金报酬提现',
    WECHAT_TRANSFER_USER_RECV_PERCEPTION: '劳务报酬',
    WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON: JSON.stringify([
      { info_type: '岗位类型', info_content: '平台推广人员' },
      { info_type: '报酬说明', info_content: 'AI爱买买平台推广佣金' },
    ]),
  };

  const buildService = (overrides: Record<string, string> = {}) => {
    const values = { ...baseConfig, ...overrides };
    const config = {
      get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
    } as unknown as ConfigService;
    const service = new WechatMerchantTransferService(config);
    service.onModuleInit();
    return service;
  };

  const signWechatBody = (rawBody: string, timestamp = Math.floor(Date.now() / 1000).toString()) => {
    const nonce = 'response-nonce';
    const signer = createSign('RSA-SHA256');
    signer.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
    signer.end();
    return {
      signature: signer.sign(wechatKeys.privateKey, 'base64'),
      timestamp,
      nonce,
      serial: publicKeyId,
    };
  };

  const response = (status: number, data: any, validSignature = true) => {
    const rawBody = JSON.stringify(data);
    const signed = signWechatBody(rawBody);
    const headers: Record<string, string> = {
      'wechatpay-signature': validSignature ? signed.signature : 'invalid-signature',
      'wechatpay-timestamp': signed.timestamp,
      'wechatpay-nonce': signed.nonce,
      'wechatpay-serial': signed.serial,
    };
    return {
      status,
      text: jest.fn().mockResolvedValue(rawBody),
      headers: {
        get: (name: string) => headers[name.toLowerCase()] ?? null,
      },
    } as any;
  };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses only the current single-transfer POST and returns WAIT_USER_CONFIRM package', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, {
      out_bill_no: 'WX123456789012345678901234567890',
      transfer_bill_no: '2026080200001',
      state: 'WAIT_USER_CONFIRM',
      package_info: 'affffddafdfafddffda==',
    })) as any;
    const service = buildService();

    const result = await service.createTransfer({
      outBillNo: 'WX123456789012345678901234567890',
      openId: 'openid-from-server-session',
      amountFen: 8_000,
    });

    expect(result).toMatchObject({
      outcome: 'FOUND',
      state: 'WAIT_USER_CONFIRM',
      packageInfo: 'affffddafdfafddffda==',
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/fund-app/mch-transfer/transfer-bills');
    expect(JSON.parse(init.body)).toMatchObject({
      appid: 'wx-mini-app',
      out_bill_no: 'WX123456789012345678901234567890',
      openid: 'openid-from-server-session',
      transfer_amount: 8_000,
    });
  });

  it('requires the exact approved 1005 commission-remuneration scene contents', () => {
    const incomplete = buildService({
      WECHAT_TRANSFER_SCENE_ID: '1005',
      WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON: JSON.stringify([
        { info_type: '岗位类型', info_content: '平台推广人员' },
      ]),
    });
    const complete = buildService({
      WECHAT_TRANSFER_SCENE_ID: '1005',
      WECHAT_TRANSFER_USER_RECV_PERCEPTION: '劳务报酬',
      WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON: JSON.stringify([
        { info_type: '岗位类型', info_content: '平台推广人员' },
        { info_type: '报酬说明', info_content: 'AI爱买买平台推广佣金' },
      ]),
    });

    expect(incomplete.isAvailable()).toBe(false);
    expect(complete.isAvailable()).toBe(true);
  });

  it('fails closed when the 1005 user-facing transfer purpose is not an official value', () => {
    const service = buildService({
      WECHAT_TRANSFER_SCENE_ID: '1005',
      WECHAT_TRANSFER_USER_RECV_PERCEPTION: '消费积分提现',
      WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON: JSON.stringify([
        { info_type: '岗位类型', info_content: '平台推广人员' },
        { info_type: '报酬说明', info_content: 'AI爱买买平台推广佣金' },
      ]),
    });

    expect(service.isAvailable()).toBe(false);
  });

  it('fails closed for any scene ID or approved report content drift', () => {
    const wrongScene = buildService({ WECHAT_TRANSFER_SCENE_ID: '1000' });
    const wrongRole = buildService({
      WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON: JSON.stringify([
        { info_type: '岗位类型', info_content: '平台推广合作方' },
        { info_type: '报酬说明', info_content: 'AI爱买买平台推广佣金' },
      ]),
    });
    const wrongDescription = buildService({
      WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON: JSON.stringify([
        { info_type: '岗位类型', info_content: '平台推广人员' },
        { info_type: '报酬说明', info_content: '用户奖励提现' },
      ]),
    });

    expect(wrongScene.isAvailable()).toBe(false);
    expect(wrongRole.isAvailable()).toBe(false);
    expect(wrongDescription.isAvailable()).toBe(false);
  });

  it('keeps settlement available after new transfers are disabled', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, {
      mch_id: '1900000109',
      appid: 'wx-mini-app',
      out_bill_no: 'WX123456789012345678901234567890',
      transfer_bill_no: '2026080200002',
      openid: 'openid-from-server-session',
      state: 'SUCCESS',
      transfer_amount: 8_000,
    })) as any;
    const service = buildService({ WECHAT_TRANSFER_ENABLED: 'false' });

    expect(service.isAvailable()).toBe(false);
    expect(service.isSettlementAvailable()).toBe(true);
    await expect(service.queryTransfer('WX123456789012345678901234567890'))
      .resolves.toMatchObject({ outcome: 'FOUND', state: 'SUCCESS' });
    await expect(service.createTransfer({
      outBillNo: 'WX123456789012345678901234567890',
      openId: 'openid-from-server-session',
      amountFen: 8_000,
    })).rejects.toThrow('微信提现新建通道配置不可用');
  });

  it('on an untrusted create response queries only the same outBillNo and returns UNKNOWN on signed 404', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(200, {
        out_bill_no: 'WX123456789012345678901234567890',
        transfer_bill_no: 'forged',
        state: 'SUCCESS',
      }, false))
      .mockResolvedValueOnce(response(404, { code: 'NOT_FOUND' })) as any;
    const service = buildService();

    const result = await service.createTransfer({
      outBillNo: 'WX123456789012345678901234567890',
      openId: 'openid-from-server-session',
      amountFen: 8_000,
    });

    expect(result).toEqual({
      outcome: 'UNKNOWN',
      outBillNo: 'WX123456789012345678901234567890',
      errorCode: 'INVALID_WECHATPAY_SIGNATURE',
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(
      'https://api.mch.weixin.qq.com/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/WX123456789012345678901234567890',
    );
  });

  it('preserves a verified create rejection code when the original bill is not found', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(400, { code: 'NO_AUTH', message: 'merchant transfer is not authorized' }))
      .mockResolvedValueOnce(response(404, { code: 'NOT_FOUND' })) as any;
    const service = buildService();

    await expect(service.createTransfer({
      outBillNo: 'WX123456789012345678901234567890',
      openId: 'openid-from-server-session',
      amountFen: 800,
    })).resolves.toEqual({
      outcome: 'UNKNOWN',
      outBillNo: 'WX123456789012345678901234567890',
      errorCode: 'NO_AUTH',
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('verifies and parses all identity fields from an out-bill-no query response', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, {
      mch_id: '1900000109',
      appid: 'wx-mini-app',
      out_bill_no: 'WX123456789012345678901234567890',
      transfer_bill_no: '2026080200002',
      openid: 'openid-from-server-session',
      state: 'SUCCESS',
      transfer_amount: 8_000,
    })) as any;
    const service = buildService();

    await expect(service.queryTransfer('WX123456789012345678901234567890'))
      .resolves.toEqual({
        outcome: 'FOUND',
        state: 'SUCCESS',
        mchId: '1900000109',
        appId: 'wx-mini-app',
        outBillNo: 'WX123456789012345678901234567890',
        transferBillNo: '2026080200002',
        openId: 'openid-from-server-session',
        amountFen: 8_000,
      });
  });

  it('accepts the official optional openid omission without inventing an identity', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, {
      mch_id: '1900000109',
      appid: 'wx-mini-app',
      out_bill_no: 'WX123456789012345678901234567890',
      transfer_bill_no: '2026080200002',
      state: 'SUCCESS',
      transfer_amount: 8_000,
    })) as any;
    const service = buildService();

    await expect(service.queryTransfer('WX123456789012345678901234567890'))
      .resolves.toMatchObject({ outcome: 'FOUND', openId: undefined });
  });

  it('uses the current single-transfer cancel endpoint for lost confirmation recovery', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, {
      out_bill_no: 'WX123456789012345678901234567890',
      transfer_bill_no: '2026080200002',
      state: 'CANCELING',
    })) as any;
    const service = buildService();

    await expect(service.cancelTransfer('WX123456789012345678901234567890'))
      .resolves.toEqual({
        accepted: true,
        state: 'CANCELING',
        transferBillNo: '2026080200002',
      });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(
      'https://api.mch.weixin.qq.com/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/'
      + 'WX123456789012345678901234567890/cancel',
    );
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('rejects a signed cancel response whose original bill identity or state differs', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, {
      out_bill_no: 'ANOTHER-BILL',
      transfer_bill_no: '2026080200999',
      state: 'SUCCESS',
    })) as any;
    const service = buildService();

    await expect(service.cancelTransfer('WX123456789012345678901234567890'))
      .resolves.toEqual({ accepted: false, errorCode: 'CANCEL_RESPONSE_MISMATCH' });
  });

  it('verifies rawBody RSA signature and decrypts the terminal APIv3 callback', () => {
    const service = buildService();
    const plaintext = JSON.stringify({
      out_bill_no: 'WX123456789012345678901234567890',
      transfer_bill_no: '2026080200003',
      state: 'SUCCESS',
      mch_id: '1900000109',
      transfer_amount: 8_000,
      openid: 'openid-from-server-session',
    });
    const nonce = '123456789012';
    const associatedData = 'transfer-notify';
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
    cipher.setAAD(Buffer.from(associatedData));
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
    const body = {
      id: 'wechat-event-1',
      event_type: 'MCHTRANSFER.BILL.FINISHED',
      resource_type: 'encrypt-resource',
      resource: {
        original_type: 'mch_payment',
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: encrypted,
        nonce,
        associated_data: associatedData,
      },
    };
    const rawBody = JSON.stringify(body);
    const headers = signWechatBody(rawBody);

    expect(service.parseNotify({
      rawBody,
      headers,
      // 即使调用方传入另一个 body，也只能解析已验签 rawBody。
      body: { resource: { ciphertext: 'untrusted' } },
    })).toEqual({
      eventId: 'wechat-event-1',
      outBillNo: 'WX123456789012345678901234567890',
      transferBillNo: '2026080200003',
      state: 'SUCCESS',
      mchId: '1900000109',
      openId: 'openid-from-server-session',
      amountFen: 8_000,
    });
  });

  it('rejects stale callback signatures', () => {
    const service = buildService();
    const rawBody = JSON.stringify({ event_type: 'MCHTRANSFER.BILL.FINISHED' });
    const stale = Math.floor(Date.now() / 1000 - 301).toString();
    expect(() => service.parseNotify({
      rawBody,
      headers: signWechatBody(rawBody, stale),
      body: {},
    })).toThrow('微信转账签名已过期');
  });

  it('decrypts a legal callback when associated_data is omitted', () => {
    const service = buildService();
    const plaintext = JSON.stringify({
      out_bill_no: 'WX123456789012345678901234567890',
      transfer_bill_no: '2026080200004',
      state: 'CANCELLED',
      mch_id: '1900000109',
      transfer_amount: 8_000,
      openid: 'openid-from-server-session',
    });
    const nonce = '123456789012';
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
    cipher.setAAD(Buffer.from(''));
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
    const body = {
      id: 'wechat-event-no-aad',
      event_type: 'MCHTRANSFER.BILL.FINISHED',
      resource_type: 'encrypt-resource',
      resource: {
        original_type: 'mch_payment',
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: encrypted,
        nonce,
      },
    };
    const rawBody = JSON.stringify(body);

    expect(service.parseNotify({ rawBody, headers: signWechatBody(rawBody), body: {} }))
      .toMatchObject({ eventId: 'wechat-event-no-aad', state: 'CANCELLED' });
  });

  it('fails closed when transfer configuration is incomplete', async () => {
    const service = buildService({ WECHAT_PAY_PUBLIC_KEY_ID: '' });
    expect(service.isAvailable()).toBe(false);
    expect(service.isSettlementAvailable()).toBe(false);
    await expect(service.queryTransfer('WX123456789012345678901234567890'))
      .rejects.toThrow('微信提现结算通道配置不可用');
  });
});
