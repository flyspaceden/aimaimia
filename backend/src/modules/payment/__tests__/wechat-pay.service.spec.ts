import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WechatPayService } from '../wechat-pay.service';

jest.mock('wechatpay-node-v3', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    transactions_app: jest.fn(),
    refunds: jest.fn(),
    find_refunds: jest.fn(),
    query: jest.fn(),
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

  describe('queryOrder', () => {
    it('returns null when SDK is not initialized', async () => {
      const svc = await buildModule({});

      await expect(svc.queryOrder('CS-1')).resolves.toBeNull();
    });

    it('queries by out_trade_no and returns parsed SUCCESS payload', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.query = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          trade_state: 'SUCCESS',
          transaction_id: 'WX-TXN-1',
          out_trade_no: 'CS-1',
          amount: { total: 1234 },
          success_time: '2026-05-23T10:11:12+08:00',
        },
      });

      const result = await svc.queryOrder('CS-1');

      expect(client.query).toHaveBeenCalledWith({ out_trade_no: 'CS-1' });
      expect(result).toEqual({
        tradeState: 'SUCCESS',
        transactionId: 'WX-TXN-1',
        outTradeNo: 'CS-1',
        totalAmountFen: 1234,
        totalAmount: 12.34,
        paidAt: new Date('2026-05-23T10:11:12+08:00'),
      });
    });

    it('returns parsed NOTPAY payload without requiring paidAt or transactionId', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.query = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          trade_state: 'NOTPAY',
          out_trade_no: 'CS-NOTPAY-1',
          amount: { total: 0 },
        },
      });

      const result = await svc.queryOrder('CS-NOTPAY-1');

      expect(result).toEqual({
        tradeState: 'NOTPAY',
        outTradeNo: 'CS-NOTPAY-1',
        totalAmountFen: 0,
        totalAmount: 0,
      });
      expect(result?.paidAt).toBeUndefined();
      expect(result).not.toHaveProperty('transactionId');
    });

    it('returns null and warns when SUCCESS payload is missing transaction_id without leaking raw provider payload', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerWarn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(jest.fn());
      client.query = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          trade_state: 'SUCCESS',
          out_trade_no: 'CS-SUCCESS-NO-TXN',
          amount: { total: 100 },
          rawSecretPayload: 'RAW-SUCCESS-NO-TXN-SECRET',
        },
      });

      const result = await svc.queryOrder('CS-SUCCESS-NO-TXN');

      expect(result).toBeNull();
      const logged = loggerWarn.mock.calls.flat().join(' ');
      expect(logged).toContain('outTradeNo=CS-***-TXN');
      expect(logged).not.toContain('RAW-SUCCESS-NO-TXN-SECRET');
      loggerWarn.mockRestore();
    });

    it('returns null and warns when trade_state is outside official WeChat states without leaking raw provider payload', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerWarn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(jest.fn());
      client.query = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          trade_state: 'PAID_OK',
          transaction_id: 'WX-TXN-UNKNOWN-STATE',
          out_trade_no: 'CS-UNKNOWN-STATE',
          amount: { total: 100 },
          rawSecretPayload: 'RAW-UNKNOWN-STATE-SECRET',
        },
      });

      const result = await svc.queryOrder('CS-UNKNOWN-STATE');

      expect(result).toBeNull();
      const logged = loggerWarn.mock.calls.flat().join(' ');
      expect(logged).toContain('outTradeNo=CS-***TATE');
      expect(logged).not.toContain('PAID_OK');
      expect(logged).not.toContain('WX-TXN-UNKNOWN-STATE');
      expect(logged).not.toContain('RAW-UNKNOWN-STATE-SECRET');
      loggerWarn.mockRestore();
    });

    it('returns null on non-200 SDK response and logs only sanitized context', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerError = jest.spyOn((svc as any).logger, 'error').mockImplementation(jest.fn());
      client.query = jest.fn().mockResolvedValue({
        status: 404,
        error: JSON.stringify({
          code: 'ORDER_NOT_EXIST',
          message: 'raw non-200 secret should not leak',
        }),
        data: {
          rawSecretPayload: 'RAW-NON200-SECRET',
        },
      });

      const result = await svc.queryOrder('CS-NON200-001');

      expect(result).toBeNull();
      const logged = loggerError.mock.calls.flat().join(' ');
      expect(logged).toContain('status=404 code=ORDER_NOT_EXIST outTradeNo=CS-***-001');
      expect(logged).not.toContain('raw non-200 secret should not leak');
      expect(logged).not.toContain('RAW-NON200-SECRET');
      expect(logged).not.toContain('{"code":"ORDER_NOT_EXIST"');
      loggerError.mockRestore();
    });

    it('returns null when SDK throws and does not leak raw exception payload', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerError = jest.spyOn((svc as any).logger, 'error').mockImplementation(jest.fn());
      client.query = jest.fn().mockRejectedValue(Object.assign(
        new Error('raw thrown payload should not leak'),
        {
          code: 'SYSTEM_ERROR',
          response: {
            data: {
              rawSecretPayload: 'RAW-THROW-SECRET',
            },
          },
        },
      ));

      const result = await svc.queryOrder('CS-THROW-001');

      expect(result).toBeNull();
      const logged = loggerError.mock.calls.flat().join(' ');
      expect(logged).toContain('code=SYSTEM_ERROR outTradeNo=CS-***-001');
      expect(logged).not.toContain('raw thrown payload should not leak');
      expect(logged).not.toContain('RAW-THROW-SECRET');
      loggerError.mockRestore();
    });

    it('returns null for runtime null outTradeNo and does not call SDK', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.query = jest.fn();

      const result = await (svc as any).queryOrder(null);

      expect(result).toBeNull();
      expect(client.query).not.toHaveBeenCalled();
    });

    it.each([
      ['empty', ''],
      ['too long', 'T'.repeat(33)],
    ])('returns null for %s outTradeNo and does not call SDK', async (_case, outTradeNo) => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.query = jest.fn();

      const result = await svc.queryOrder(outTradeNo);

      expect(result).toBeNull();
      expect(client.query).not.toHaveBeenCalled();
    });

    it.each([
      ['missing trade_state', {
        out_trade_no: 'CS-MISSING-STATE',
        amount: { total: 100 },
      }],
      ['non-integer amount.total', {
        trade_state: 'SUCCESS',
        out_trade_no: 'CS-BAD-AMOUNT',
        transaction_id: 'WX-TXN-BAD-AMOUNT',
        amount: { total: 100.5 },
      }],
    ])('returns null when query payload has %s', async (_case, data) => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.query = jest.fn().mockResolvedValue({
        status: 200,
        data,
      });

      const result = await svc.queryOrder(data.out_trade_no);

      expect(result).toBeNull();
    });

    it('returns null and warns when response out_trade_no differs from request', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerWarn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(jest.fn());
      client.query = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          trade_state: 'SUCCESS',
          transaction_id: 'WX-TXN-MISMATCH',
          out_trade_no: 'CS-OTHER-456',
          amount: { total: 100 },
        },
      });

      const result = await svc.queryOrder('CS-REQUEST-123');

      expect(result).toBeNull();
      const logged = loggerWarn.mock.calls.flat().join(' ');
      expect(logged).toContain('outTradeNo=CS-***-123');
      expect(logged).toContain('providerOutTradeNo=CS-***-456');
      loggerWarn.mockRestore();
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

  describe('queryRefund', () => {
    it('returns null when SDK is not initialized', async () => {
      const svc = await buildModule({});

      await expect(svc.queryRefund('RF-QUERY-001')).resolves.toBeNull();
    });

    it('queries by out_refund_no and returns parsed SUCCESS payload', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          out_refund_no: 'RF-QUERY-001',
          out_trade_no: 'CS-REFUND-001',
          refund_id: 'wxrefund-query-001',
          status: 'SUCCESS',
          amount: {
            refund: 1234,
            total: 2000,
          },
          success_time: '2026-05-23T10:11:12+08:00',
        },
      });

      const result = await svc.queryRefund('RF-QUERY-001');

      expect(client.find_refunds).toHaveBeenCalledWith('RF-QUERY-001');
      expect(result).toEqual({
        outRefundNo: 'RF-QUERY-001',
        outTradeNo: 'CS-REFUND-001',
        providerRefundId: 'wxrefund-query-001',
        status: 'SUCCESS',
        refundAmountFen: 1234,
        totalAmountFen: 2000,
        refundAmount: 12.34,
        totalAmount: 20,
        successAt: new Date('2026-05-23T10:11:12+08:00'),
      });
    });

    it('returns parsed PROCESSING payload without successAt', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          out_refund_no: 'RF-QUERY-PROCESSING',
          out_trade_no: 'CS-REFUND-PROCESSING',
          refund_id: 'wxrefund-query-processing',
          status: 'PROCESSING',
          amount: {
            refund: 500,
            total: 1200,
          },
        },
      });

      const result = await svc.queryRefund('RF-QUERY-PROCESSING');

      expect(result).toEqual({
        outRefundNo: 'RF-QUERY-PROCESSING',
        outTradeNo: 'CS-REFUND-PROCESSING',
        providerRefundId: 'wxrefund-query-processing',
        status: 'PROCESSING',
        refundAmountFen: 500,
        totalAmountFen: 1200,
        refundAmount: 5,
        totalAmount: 12,
      });
      expect(result?.successAt).toBeUndefined();
    });

    it('returns null on non-200 SDK response and logs only sanitized context', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerError = jest.spyOn((svc as any).logger, 'error').mockImplementation(jest.fn());
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 404,
        error: JSON.stringify({
          code: 'RESOURCE_NOT_EXISTS',
          message: 'raw refund query secret should not leak',
        }),
        data: {
          rawSecretPayload: 'RAW-REFUND-NON200-SECRET',
        },
      });

      const result = await svc.queryRefund('RF-NON200-001');

      expect(result).toBeNull();
      const logged = loggerError.mock.calls.flat().join(' ');
      expect(logged).toContain('status=404 code=RESOURCE_NOT_EXISTS outRefundNo=RF-***-001');
      expect(logged).not.toContain('raw refund query secret should not leak');
      expect(logged).not.toContain('RAW-REFUND-NON200-SECRET');
      expect(logged).not.toContain('{"code":"RESOURCE_NOT_EXISTS"');
      loggerError.mockRestore();
    });

    it('returns null when SDK throws and does not leak raw exception payload', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerError = jest.spyOn((svc as any).logger, 'error').mockImplementation(jest.fn());
      client.find_refunds = jest.fn().mockRejectedValue(Object.assign(
        new Error('raw thrown refund payload should not leak'),
        {
          code: 'SYSTEM_ERROR',
          response: {
            data: {
              rawSecretPayload: 'RAW-REFUND-THROW-SECRET',
            },
          },
        },
      ));

      const result = await svc.queryRefund('RF-THROW-001');

      expect(result).toBeNull();
      const logged = loggerError.mock.calls.flat().join(' ');
      expect(logged).toContain('code=SYSTEM_ERROR outRefundNo=RF-***-001');
      expect(logged).not.toContain('raw thrown refund payload should not leak');
      expect(logged).not.toContain('RAW-REFUND-THROW-SECRET');
      loggerError.mockRestore();
    });

    it('returns null for runtime null outRefundNo and does not call SDK', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.find_refunds = jest.fn();

      const result = await (svc as any).queryRefund(null);

      expect(result).toBeNull();
      expect(client.find_refunds).not.toHaveBeenCalled();
    });

    it.each([
      ['empty', ''],
      ['too long', 'R'.repeat(65)],
    ])('returns null for %s outRefundNo and does not call SDK', async (_case, outRefundNo) => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.find_refunds = jest.fn();

      const result = await svc.queryRefund(outRefundNo);

      expect(result).toBeNull();
      expect(client.find_refunds).not.toHaveBeenCalled();
    });

    it('returns null and warns when response out_refund_no differs from request', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerWarn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(jest.fn());
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          out_refund_no: 'RF-OTHER-456',
          out_trade_no: 'CS-REFUND-001',
          refund_id: 'wxrefund-query-mismatch',
          status: 'SUCCESS',
          amount: {
            refund: 100,
            total: 200,
          },
        },
      });

      const result = await svc.queryRefund('RF-REQUEST-123');

      expect(result).toBeNull();
      const logged = loggerWarn.mock.calls.flat().join(' ');
      expect(logged).toContain('outRefundNo=RF-***-123');
      expect(logged).toContain('providerOutRefundNo=RF-***-456');
      loggerWarn.mockRestore();
    });

    it('returns null and warns when refund status is outside official WeChat states without leaking raw provider payload', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerWarn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(jest.fn());
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          out_refund_no: 'RF-UNKNOWN-STATE',
          out_trade_no: 'CS-REFUND-UNKNOWN',
          refund_id: 'wxrefund-query-unknown',
          status: 'USERPAYING',
          amount: {
            refund: 100,
            total: 200,
          },
          rawSecretPayload: 'RAW-REFUND-UNKNOWN-STATE-SECRET',
        },
      });

      const result = await svc.queryRefund('RF-UNKNOWN-STATE');

      expect(result).toBeNull();
      const logged = loggerWarn.mock.calls.flat().join(' ');
      expect(logged).toContain('outRefundNo=RF-***TATE');
      expect(logged).not.toContain('USERPAYING');
      expect(logged).not.toContain('wxrefund-query-unknown');
      expect(logged).not.toContain('RAW-REFUND-UNKNOWN-STATE-SECRET');
      loggerWarn.mockRestore();
    });

    it.each([
      ['missing refund_id', {
        out_refund_no: 'RF-MISSING-REFUND-ID',
        out_trade_no: 'CS-MISSING-REFUND-ID',
        status: 'SUCCESS',
        amount: {
          refund: 100,
          total: 200,
        },
      }],
      ['non-integer amount.total', {
        out_refund_no: 'RF-BAD-TOTAL',
        out_trade_no: 'CS-BAD-TOTAL',
        refund_id: 'wxrefund-bad-total',
        status: 'SUCCESS',
        amount: {
          refund: 100,
          total: 200.5,
        },
      }],
    ])('returns null when refund query payload has %s', async (_case, data) => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.find_refunds = jest.fn().mockResolvedValue({
        status: 200,
        data,
      });

      const result = await svc.queryRefund(data.out_refund_no);

      expect(result).toBeNull();
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
        amountFen: 999,
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
        amountFen: 500,
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
        amountFen: 999,
        amount: 9.99,
        paidAt: undefined,
      });
    });

    it('accepts complete payment fields when notify metadata is missing for compatibility', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-COMPAT-PAY',
        transaction_id: 'WX-TXN-COMPAT',
        trade_state: 'SUCCESS',
        amount: { total: 1000 },
      });

      const result = await (svc as any).parseNotify({
        body: {
          resource: {
            ciphertext: 'PAY-CIPHER',
            nonce: 'RESOURCE-NONCE',
          },
        },
        rawBody,
        headers,
      });

      expect(result).toEqual({
        type: 'payment',
        outTradeNo: 'CS-COMPAT-PAY',
        providerTxnId: 'WX-TXN-COMPAT',
        tradeState: 'SUCCESS',
        amountFen: 1000,
        amount: 10,
        paidAt: undefined,
      });
    });

    it('throws when payment notify is missing transaction_id', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      const loggerError = jest.spyOn((svc as any).logger, 'error').mockImplementation(jest.fn());
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-MISSING-TXN',
        trade_state: 'SUCCESS',
        amount: { total: 100 },
        secret_payload: 'DECRYPTED-SECRET',
      });

      await expect(
        (svc as any).parseNotify({
          body: paymentNotifyBody,
          rawBody,
          headers,
        }),
      ).rejects.toThrow('微信支付通知缺少必要字段');

      const logged = loggerError.mock.calls.flat().join(' ');
      expect(logged).toContain('event_type=TRANSACTION.SUCCESS');
      expect(logged).toContain('original_type=transaction');
      expect(logged).toContain('outTradeNo=CS-***-TXN');
      expect(logged).not.toContain(rawBody);
      expect(logged).not.toContain('PAY-CIPHER');
      expect(logged).not.toContain('DECRYPTED-SECRET');
      loggerError.mockRestore();
    });

    it('throws when refund notify is missing refund_id', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-REFUND-MISSING-ID',
        out_refund_no: 'RF-MISSING-ID',
        refund_status: 'SUCCESS',
        amount: { refund: 100 },
      });

      await expect(
        (svc as any).parseNotify({
          body: {
            event_type: 'REFUND.SUCCESS',
            resource: {
              original_type: 'refund',
              ciphertext: 'REFUND-CIPHER',
              nonce: 'REFUND-RESOURCE-NONCE',
            },
          },
          rawBody,
          headers,
        }),
      ).rejects.toThrow('微信退款通知缺少必要字段');
    });

    it('throws instead of treating unknown transaction events as payment', async () => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-UNKNOWN-EVENT',
        transaction_id: 'WX-TXN-UNKNOWN',
        trade_state: 'SUCCESS',
        amount: { total: 100 },
      });

      await expect(
        (svc as any).parseNotify({
          body: {
            event_type: 'UNKNOWN.SUCCESS',
            resource: {
              original_type: 'transaction',
              ciphertext: 'PAY-CIPHER',
              nonce: 'RESOURCE-NONCE',
            },
          },
          rawBody,
          headers,
        }),
      ).rejects.toThrow('微信通知事件类型不支持');
    });

    it.each([
      ['non-integer', 100.5],
      ['negative', -1],
    ])('throws when payment amount.total is %s', async (_case, total) => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-BAD-PAY-AMOUNT',
        transaction_id: 'WX-TXN-BAD-AMOUNT',
        trade_state: 'SUCCESS',
        amount: { total },
      });

      await expect(
        (svc as any).parseNotify({
          body: paymentNotifyBody,
          rawBody,
          headers,
        }),
      ).rejects.toThrow('微信通知金额字段无效');
    });

    it.each([
      ['non-integer', 100.5],
      ['negative', -1],
    ])('throws when refund amount.refund is %s', async (_case, refund) => {
      const svc = await buildModule(validWechatEnv);
      const client = (svc as any).client;
      client.verifySign = jest.fn().mockReturnValue(true);
      client.decipher_gcm = jest.fn().mockReturnValue({
        out_trade_no: 'CS-BAD-REFUND-AMOUNT',
        out_refund_no: 'RF-BAD-AMOUNT',
        refund_id: 'WX-REFUND-BAD-AMOUNT',
        refund_status: 'SUCCESS',
        amount: { refund },
      });

      await expect(
        (svc as any).parseNotify({
          body: {
            event_type: 'REFUND.SUCCESS',
            resource: {
              original_type: 'refund',
              ciphertext: 'REFUND-CIPHER',
              nonce: 'REFUND-RESOURCE-NONCE',
            },
          },
          rawBody,
          headers,
        }),
      ).rejects.toThrow('微信通知金额字段无效');
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
