import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WechatPayService } from '../wechat-pay.service';

jest.mock('wechatpay-node-v3', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    transactions_app: jest.fn(),
    refunds: jest.fn(),
    verifySign: jest.fn(),
    decipher_gcm: jest.fn(),
  })),
}));

describe('WechatPayService', () => {
  const validWechatEnv = {
    WECHAT_PAY_APP_ID: 'wxtest',
    WECHAT_PAY_MCH_ID: '1234567890',
    WECHAT_PAY_API_V3_KEY: 'a'.repeat(32),
    WECHAT_PAY_MERCHANT_CERT_SERIAL: 'ABC123',
    WECHAT_PAY_MERCHANT_CERT: '-----BEGIN CERTIFICATE-----\nFAKECERT\n-----END CERTIFICATE-----',
    WECHAT_PAY_MERCHANT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
  };

  const buildModule = async (envOverrides: Record<string, string | undefined>) => {
    const fakeConfig = {
      get: (key: string, defaultValue?: string) => envOverrides[key] ?? defaultValue,
    } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      providers: [
        WechatPayService,
        { provide: ConfigService, useValue: fakeConfig },
      ],
    }).compile();
    const svc = moduleRef.get(WechatPayService);
    await svc.onModuleInit();
    return svc;
  };

  describe('isAvailable', () => {
    it('returns false when WECHAT_PAY_APP_ID missing', async () => {
      const svc = await buildModule({});
      expect(svc.isAvailable()).toBe(false);
    });

    it('returns false when only partial credentials configured', async () => {
      const svc = await buildModule({
        WECHAT_PAY_APP_ID: 'wxtest',
        WECHAT_PAY_MCH_ID: '1234567890',
        // missing API V3 key + serial + private key
      });
      expect(svc.isAvailable()).toBe(false);
    });

    it('returns true when all required credentials present', async () => {
      const svc = await buildModule(validWechatEnv);
      expect(svc.isAvailable()).toBe(true);
    });
  });

  describe('createAppOrder', () => {
    it('throws when SDK not available', async () => {
      const svc = await buildModule({});
      await expect(
        svc.createAppOrder({
          outTradeNo: 'CS-123',
          amount: 9.99,
          description: 'test',
        }),
      ).rejects.toThrow('微信支付 SDK 未初始化');
    });

    it('converts amount yuan to fen and returns signed app payload', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      // ⚠️ wechatpay-node-v3 SDK 实际返回 { status, data }，APP 支付字段在 data 内且为全小写
      // 参考 https://github.com/klover2/wechatpay-node-v3-ts/blob/master/docs/transactions_app.md
      client.transactions_app = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          appid: 'wxtest',
          partnerid: '1234567890',
          prepayid: 'wx2024xxxxxxxxxxxxxxxx',
          package: 'Sign=WXPay',
          noncestr: 'NONCESTRX',
          timestamp: '1700000000',
          sign: 'SIGNED',
        },
      });

      const result = await svc.createAppOrder({
        outTradeNo: 'CS-456',
        amount: 9.99,
        description: 'unit test',
      });

      expect(client.transactions_app).toHaveBeenCalledWith(
        expect.objectContaining({
          out_trade_no: 'CS-456',
          description: 'unit test',
          amount: { total: 999, currency: 'CNY' },
          notify_url: expect.any(String),
        }),
      );
      // Service 对外（给 App 用）统一 camelCase，方便和 alipay 路径对齐
      expect(result).toEqual({
        appId: 'wxtest',
        partnerId: '1234567890',
        timestamp: '1700000000',
        timeStamp: '1700000000',
        nonceStr: 'NONCESTRX',
        prepayId: 'wx2024xxxxxxxxxxxxxxxx',
        packageVal: 'Sign=WXPay',
        package: 'Sign=WXPay',
        signType: 'RSA',
        paySign: 'SIGNED',
        sign: 'SIGNED',
      });
    });

    it('returns native-compatible aliases matching the existing app contract fields', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.transactions_app = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          appid: 'wxtest',
          partnerid: '1234567890',
          prepayid: 'wx2024xxxxxxxxxxxxxxxx',
          package: 'Sign=WXPay',
          noncestr: 'NONCESTRX',
          timestamp: '1700000000',
          sign: 'SIGNED',
        },
      });

      const result = await svc.createAppOrder({
        outTradeNo: 'CS-ALIAS',
        amount: 9.99,
        description: 'unit test',
      });

      expect(result.timeStamp).toBe(result.timestamp);
      expect(result.package).toBe(result.packageVal);
      expect(result.sign).toBe(result.paySign);
    });

    it('throws when amount is not a finite number', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.transactions_app = jest.fn();

      await expect(
        svc.createAppOrder({ outTradeNo: 'CS-BAD-AMOUNT', amount: Number.NaN, description: 't' }),
      ).rejects.toThrow('amount 必须是有效数字');
      expect(client.transactions_app).not.toHaveBeenCalled();
    });

    it('throws when amount has more than 2 decimal places', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.transactions_app = jest.fn();

      await expect(
        svc.createAppOrder({ outTradeNo: 'CS-BAD-DECIMAL', amount: 1.234, description: 't' }),
      ).rejects.toThrow('amount 最多支持 2 位小数');
      expect(client.transactions_app).not.toHaveBeenCalled();
    });

    it('throws when outTradeNo exceeds 32 chars', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.transactions_app = jest.fn();

      await expect(
        svc.createAppOrder({
          outTradeNo: 'T'.repeat(33),
          amount: 1,
          description: 't',
        }),
      ).rejects.toThrow('outTradeNo 不能超过 32 个字符');
      expect(client.transactions_app).not.toHaveBeenCalled();
    });

    it('throws sanitized error when SDK response lacks prepayid or sign', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerError = jest.spyOn((svc as any).logger, 'error').mockImplementation(jest.fn());
      client.transactions_app = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          appid: 'wxtest',
          partnerid: '1234567890',
          prepayid: 'wx2024xxxxxxxxxxxxxxxx',
          package: 'Sign=WXPay',
          noncestr: 'NONCESTRX',
          timestamp: '1700000000',
          rawSecretPayload: 'SHOULD_NOT_LEAK',
        },
      });

      let thrown: Error | null = null;
      try {
        await svc.createAppOrder({ outTradeNo: 'CS-MISSING-SIGN', amount: 1, description: 't' });
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown?.message).toBe('微信支付下单返回缺少必要签名字段');
      expect(thrown?.message).not.toContain('SHOULD_NOT_LEAK');
      const logged = loggerError.mock.calls.flat().join(' ');
      expect(logged).toContain('outTradeNo=CS-***SIGN');
      expect(logged).not.toContain('SHOULD_NOT_LEAK');
      loggerError.mockRestore();
    });

    it('throws on non-200 SDK response', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerError = jest.spyOn((svc as any).logger, 'error').mockImplementation(jest.fn());
      client.transactions_app = jest.fn().mockResolvedValue({
        status: 400,
        error: JSON.stringify({ code: 'PARAM_ERROR', message: 'amount invalid' }),
      });
      await expect(
        svc.createAppOrder({ outTradeNo: 'CS-789', amount: 1, description: 't' }),
      ).rejects.toThrow(/PARAM_ERROR/);
      const logged = loggerError.mock.calls.flat().join(' ');
      expect(logged).toContain('status=400 code=PARAM_ERROR outTradeNo=CS-***-789');
      expect(logged).not.toContain('amount invalid');
      expect(logged).not.toContain('{"code":"PARAM_ERROR"');
      loggerError.mockRestore();
    });
  });

  describe('refund', () => {
    const refundParams = {
      outTradeNo: 'CS-REFUND-001',
      outRefundNo: 'RF-REFUND-001',
      refundAmount: 12.34,
      totalAmount: 20,
      reason: '用户申请退款',
    };

    it('returns failed result when SDK not available', async () => {
      const svc = await buildModule({});

      await expect(svc.refund(refundParams)).resolves.toEqual({
        success: false,
        pending: false,
        message: '微信支付 SDK 未初始化',
      });
    });

    it('calls refunds with fen amounts and returns success on SUCCESS status', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          status: 'SUCCESS',
          refund_id: 'wxrefund-success-001',
        },
      });

      const result = await svc.refund(refundParams);

      expect(client.refunds).toHaveBeenCalledWith({
        out_trade_no: 'CS-REFUND-001',
        out_refund_no: 'RF-REFUND-001',
        reason: '用户申请退款',
        notify_url: 'https://api.ai-maimai.com/api/v1/payments/wechat/notify',
        amount: {
          refund: 1234,
          total: 2000,
          currency: 'CNY',
        },
      });
      expect(result).toEqual({
        success: true,
        pending: false,
        providerRefundId: 'wxrefund-success-001',
        message: '退款成功',
      });
    });

    it('returns pending result on PROCESSING status', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          status: 'PROCESSING',
          refund_id: 'wxrefund-processing-001',
        },
      });

      await expect(svc.refund(refundParams)).resolves.toEqual({
        success: true,
        pending: true,
        providerRefundId: 'wxrefund-processing-001',
        message: '退款受理中，等待结果通知',
      });
    });

    it.each(['CLOSED', 'ABNORMAL'])('returns failed result on %s status', async (status) => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          status,
          refund_id: `wxrefund-${status.toLowerCase()}`,
        },
      });

      const result = await svc.refund(refundParams);

      expect(result).toEqual(expect.objectContaining({
        success: false,
        pending: false,
      }));
      expect(result.message).toContain(status);
    });

    it.each(['USERPAYING', 'UNKNOWN_STATUS'])(
      'returns failed result on unexpected %s status',
      async (status) => {
        const svc = await buildModule(validWechatEnv);
        const client = (svc as any).client;
        client.refunds = jest.fn().mockResolvedValue({
          status: 200,
          data: {
            status,
            refund_id: `wxrefund-${status.toLowerCase()}`,
          },
        });

        const result = await svc.refund(refundParams);

        expect(result).toEqual(expect.objectContaining({
          success: false,
          pending: false,
        }));
        expect(result.message).toContain(status);
      },
    );

    it('returns failed result with SDK error code and message on non-200 response', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerError = jest.spyOn((svc as any).logger, 'error').mockImplementation(jest.fn());
      client.refunds = jest.fn().mockResolvedValue({
        status: 400,
        error: JSON.stringify({ code: 'PARAM_ERROR', message: 'refund amount invalid' }),
      });

      const result = await svc.refund(refundParams);

      expect(result).toEqual({
        success: false,
        pending: false,
        message: '微信退款失败 [PARAM_ERROR] refund amount invalid',
      });
      const logged = loggerError.mock.calls.flat().join(' ');
      expect(logged).toContain('status=400 code=PARAM_ERROR');
      expect(logged).toContain('outTradeNo=CS-***-001');
      expect(logged).toContain('outRefundNo=RF-***-001');
      expect(logged).not.toContain('refund amount invalid');
      expect(logged).not.toContain('{"code":"PARAM_ERROR"');
      loggerError.mockRestore();
    });

    it('treats missing data.status as pending instead of success', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          refund_id: 'wxrefund-missing-status',
        },
      });

      await expect(svc.refund(refundParams)).resolves.toEqual({
        success: true,
        pending: true,
        providerRefundId: 'wxrefund-missing-status',
        message: '微信退款状态待确认',
      });
    });

    it('rejects refundAmount with more than 2 decimal places and does not call SDK', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.refunds = jest.fn();

      const result = await svc.refund({
        ...refundParams,
        refundAmount: 1.234,
      });

      expect(result).toEqual({
        success: false,
        pending: false,
        message: 'refundAmount 最多支持 2 位小数',
      });
      expect(client.refunds).not.toHaveBeenCalled();
    });

    it('rejects totalAmount with more than 2 decimal places and does not call SDK', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.refunds = jest.fn();

      const result = await svc.refund({
        ...refundParams,
        totalAmount: 12.345,
      });

      expect(result).toEqual({
        success: false,
        pending: false,
        message: 'totalAmount 最多支持 2 位小数',
      });
      expect(client.refunds).not.toHaveBeenCalled();
    });

    it('rejects refundAmount greater than totalAmount and does not call SDK', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.refunds = jest.fn();

      const result = await svc.refund({
        ...refundParams,
        refundAmount: 20.01,
        totalAmount: 20,
      });

      expect(result).toEqual({
        success: false,
        pending: false,
        message: 'refundAmount 不能大于 totalAmount',
      });
      expect(client.refunds).not.toHaveBeenCalled();
    });

    it.each([
      ['', 'outRefundNo 不能为空'],
      ['R'.repeat(65), 'outRefundNo 不能超过 64 个字符'],
    ])('rejects invalid outRefundNo and does not call SDK', async (outRefundNo, message) => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.refunds = jest.fn();

      const result = await svc.refund({
        ...refundParams,
        outRefundNo,
      });

      expect(result).toEqual({
        success: false,
        pending: false,
        message,
      });
      expect(client.refunds).not.toHaveBeenCalled();
    });

    it('rejects outTradeNo over 32 chars and does not call SDK', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.refunds = jest.fn();

      const result = await svc.refund({
        ...refundParams,
        outTradeNo: 'T'.repeat(33),
      });

      expect(result).toEqual({
        success: false,
        pending: false,
        message: 'outTradeNo 不能超过 32 个字符',
      });
      expect(client.refunds).not.toHaveBeenCalled();
    });
  });

  describe('parseNotify', () => {
    const rawBody = '{"id":"notify-001","resource":{"ciphertext":"PAY-CIPHER"}}';
    const headers = {
      signature: 'SIGNATURE',
      timestamp: '1710000000',
      nonce: 'HEADER-NONCE',
      serial: 'PLATFORM-SERIAL',
    };

    const paymentNotifyBody = {
      event_type: 'TRANSACTION.SUCCESS',
      resource: {
        original_type: 'transaction',
        ciphertext: 'PAY-CIPHER',
        nonce: 'RESOURCE-NONCE',
        associated_data: 'transaction',
      },
    };

    it('throws when SDK not available', async () => {
      const svc = await buildModule({});

      await expect(
        (svc as any).parseNotify({
          body: paymentNotifyBody,
          rawBody,
          headers,
        }),
      ).rejects.toThrow('微信支付 SDK 未初始化');
    });

    it('throws when notify signature verification returns false', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(false);
      client.decipher_gcm = jest.fn();

      await expect(
        (svc as any).parseNotify({
          body: paymentNotifyBody,
          rawBody,
          headers,
        }),
      ).rejects.toThrow('微信通知签名校验失败');
      expect(client.decipher_gcm).not.toHaveBeenCalled();
    });

    it('calls verifySign with the rawBody string', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-NOTIFY-001',
        transaction_id: 'WX-TXN-001',
        trade_state: 'SUCCESS',
        amount: { total: 100 },
      });

      await (svc as any).parseNotify({
        body: paymentNotifyBody,
        rawBody,
        headers,
      });

      expect(client.verifySign).toHaveBeenCalledWith({
        timestamp: '1710000000',
        nonce: 'HEADER-NONCE',
        body: rawBody,
        serial: 'PLATFORM-SERIAL',
        signature: 'SIGNATURE',
        apiSecret: validWechatEnv.WECHAT_PAY_API_V3_KEY,
      });
    });

    it('decrypts a successful payment notify payload and maps fen to yuan', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-PAY-999',
        transaction_id: 'WX-TXN-999',
        trade_state: 'SUCCESS',
        amount: { total: 999 },
        success_time: '2026-05-23T10:11:12+08:00',
      });

      const result = await (svc as any).parseNotify({
        body: paymentNotifyBody,
        rawBody,
        headers,
      });

      expect(client.decipher_gcm).toHaveBeenCalledWith(
        'PAY-CIPHER',
        'transaction',
        'RESOURCE-NONCE',
        validWechatEnv.WECHAT_PAY_API_V3_KEY,
      );
      expect(result).toEqual({
        type: 'payment',
        outTradeNo: 'CS-PAY-999',
        providerTxnId: 'WX-TXN-999',
        tradeState: 'SUCCESS',
        amount: 9.99,
        paidAt: new Date('2026-05-23T10:11:12+08:00'),
      });
    });

    it('decrypts a successful refund notify payload when event_type is REFUND.SUCCESS', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-REFUND-PAY',
        out_refund_no: 'RF-NOTIFY-500',
        refund_id: 'WX-REFUND-500',
        refund_status: 'SUCCESS',
        amount: { refund: 500 },
        success_time: '2026-05-23T12:00:00+08:00',
      });

      const result = await (svc as any).parseNotify({
        body: {
          event_type: 'REFUND.SUCCESS',
          resource: {
            original_type: 'refund',
            ciphertext: 'REFUND-CIPHER',
            nonce: 'REFUND-RESOURCE-NONCE',
            associated_data: 'refund',
          },
        },
        rawBody,
        headers,
      });

      expect(result).toEqual({
        type: 'refund',
        outTradeNo: 'CS-REFUND-PAY',
        outRefundNo: 'RF-NOTIFY-500',
        providerTxnId: 'WX-REFUND-500',
        tradeState: 'SUCCESS',
        amount: 5,
        paidAt: new Date('2026-05-23T12:00:00+08:00'),
      });
    });

    it('treats resource.original_type refund as refund when event_type is missing', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-ORIGINAL-TYPE',
        out_refund_no: 'RF-ORIGINAL-TYPE',
        refund_id: 'WX-REFUND-ORIGINAL',
        refund_status: 'SUCCESS',
        amount: { refund: 500 },
      });

      const result = await (svc as any).parseNotify({
        body: {
          resource: {
            original_type: 'refund',
            ciphertext: 'REFUND-CIPHER',
            nonce: 'REFUND-RESOURCE-NONCE',
          },
        },
        rawBody,
        headers,
      });

      expect(result.type).toBe('refund');
      expect(result.outRefundNo).toBe('RF-ORIGINAL-TYPE');
    });

    it('treats decrypted out_refund_no as refund when notify metadata is ambiguous', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-DECRYPTED-REFUND',
        out_refund_no: 'RF-DECRYPTED-REFUND',
        refund_id: 'WX-REFUND-DECRYPTED',
        refund_status: 'SUCCESS',
        amount: { refund: 500 },
      });

      const result = await (svc as any).parseNotify({
        body: {
          event_type: 'UNKNOWN.SUCCESS',
          resource: {
            original_type: 'transaction',
            ciphertext: 'REFUND-CIPHER',
            nonce: 'REFUND-RESOURCE-NONCE',
          },
        },
        rawBody,
        headers,
      });

      expect(result.type).toBe('refund');
      expect(result.outRefundNo).toBe('RF-DECRYPTED-REFUND');
    });

    it('parses decrypted JSON string payloads', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue(JSON.stringify({
        out_trade_no: 'CS-STRING-PAYLOAD',
        transaction_id: 'WX-TXN-STRING',
        trade_state: 'SUCCESS',
        amount: { total: 999 },
      }));

      const result = await (svc as any).parseNotify({
        body: paymentNotifyBody,
        rawBody,
        headers,
      });

      expect(result).toEqual({
        type: 'payment',
        outTradeNo: 'CS-STRING-PAYLOAD',
        providerTxnId: 'WX-TXN-STRING',
        tradeState: 'SUCCESS',
        amount: 9.99,
        paidAt: undefined,
      });
    });

    it('logs only sanitized notify context when decryption fails', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerError = jest.spyOn((svc as any).logger, 'error').mockImplementation(jest.fn());
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn(() => {
        throw new Error('decrypt failed with secret payload');
      });

      await expect(
        (svc as any).parseNotify({
          body: paymentNotifyBody,
          rawBody,
          headers,
        }),
      ).rejects.toThrow('decrypt failed with secret payload');

      const logged = loggerError.mock.calls.flat().join(' ');
      expect(logged).toContain('event_type=TRANSACTION.SUCCESS');
      expect(logged).toContain('original_type=transaction');
      expect(logged).not.toContain(rawBody);
      expect(logged).not.toContain('PAY-CIPHER');
      expect(logged).not.toContain('secret payload');
      loggerError.mockRestore();
    });
  });
});
