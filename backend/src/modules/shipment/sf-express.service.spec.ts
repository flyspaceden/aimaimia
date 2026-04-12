import { SfExpressService } from './sf-express.service';
import * as crypto from 'crypto';

// ─── Mock fetch ─────────────────────────────────────────

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// ─── 工厂函数 ───────────────────────────────────────────

function createService(overrides: Record<string, string> = {}) {
  const config: Record<string, string> = {
    SF_ENV: 'UAT',
    SF_API_URL_UAT: 'https://sfapi-sbox.sf-express.com/std/service',
    SF_API_URL: 'https://bsp-oisp.sf-express.com/std/service',
    SF_CLIENT_CODE: 'TEST_CLIENT',
    SF_CHECK_WORD: 'test_check_word_secret',
    SF_MONTHLY_ACCOUNT: '7551253482',
    SF_CALLBACK_URL: 'https://api.example.com/api/v1/shipments/sf/callback',
    SF_TEMPLATE_CODE: 'fm_150_standard_test',
    ...overrides,
  };
  const configService = {
    get: jest.fn(
      (key: string, defaultVal?: string) => config[key] ?? defaultVal ?? '',
    ),
  };
  return new SfExpressService(configService as any);
}

/** 构造顺丰 API 成功响应 */
function sfSuccess(msgData: any) {
  return {
    ok: true,
    json: async () => ({
      apiResultCode: 'A1000',
      apiErrorMsg: '',
      msgData: JSON.stringify(msgData),
    }),
  };
}

/** 构造顺丰 API 业务错误响应 */
function sfBusinessError(code: string, msg: string) {
  return {
    ok: true,
    json: async () => ({
      apiResultCode: code,
      apiErrorMsg: msg,
      msgData: '',
    }),
  };
}

/** 构造 HTTP 错误响应 */
function httpError(status: number) {
  return {
    ok: false,
    status,
    statusText: `Error ${status}`,
    json: async () => ({}),
  };
}

// ─── 种子数据 ───────────────────────────────────────────

const SENDER = {
  name: '澄源生态农业',
  tel: '13900001111',
  province: '云南省',
  city: '玉溪市',
  district: '红塔区',
  detail: '高新区产业园8号',
};

const RECEIVER = {
  name: '林青禾',
  tel: '13800138000',
  province: '云南省',
  city: '昆明市',
  district: '盘龙区',
  detail: '翠湖路88号',
};

// ─── 测试 ───────────────────────────────────────────────

describe('SfExpressService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ─── isConfigured ───────────────────────────────────

  describe('isConfigured', () => {
    it('所有凭证已配置时返回 true', () => {
      const svc = createService();
      expect(svc.isConfigured()).toBe(true);
    });

    it('缺少 checkWord 时返回 false', () => {
      const svc = createService({ SF_CHECK_WORD: '' });
      expect(svc.isConfigured()).toBe(false);
    });

    it('缺少 monthlyAccount 时返回 false', () => {
      const svc = createService({ SF_MONTHLY_ACCOUNT: '' });
      expect(svc.isConfigured()).toBe(false);
    });
  });

  // ─── buildVerifyCode ────────────────────────────────

  describe('buildVerifyCode', () => {
    it('对固定输入产生确定性输出（二进制MD5→Base64）', () => {
      const svc = createService();
      const msgData = '{"orderId":"test-001"}';
      const timestamp = '1712000000000';

      // 手动计算预期值：MD5(msgData + timestamp + checkWord) → binary → base64
      const raw = msgData + timestamp + 'test_check_word_secret';
      const expected = crypto
        .createHash('md5')
        .update(raw, 'utf8')
        .digest('base64');

      const result = svc.buildVerifyCode(msgData, timestamp);
      expect(result).toBe(expected);
      // 确保不是 hex → base64（hex base64 更长）
      expect(result.length).toBeLessThanOrEqual(24);
    });

    it('不同输入产生不同签名', () => {
      const svc = createService();
      const ts = '1712000000000';
      const sig1 = svc.buildVerifyCode('{"a":1}', ts);
      const sig2 = svc.buildVerifyCode('{"b":2}', ts);
      expect(sig1).not.toBe(sig2);
    });
  });

  // ─── createOrder ────────────────────────────────────

  describe('createOrder', () => {
    const baseParams = {
      orderId: 'o-001',
      sender: SENDER,
      receiver: RECEIVER,
      cargo: '云南特级普洱茶',
    };

    it('未配置时抛 BadRequestException', async () => {
      const svc = createService({ SF_CHECK_WORD: '' });
      await expect(svc.createOrder(baseParams)).rejects.toThrow(
        '顺丰丰桥服务未配置',
      );
    });

    it('成功返回 waybillNo 和 sfOrderId', async () => {
      const svc = createService();
      mockFetch.mockResolvedValueOnce(
        sfSuccess({
          orderId: 'SF_ORDER_001',
          waybillNoInfoList: [
            {
              waybillNo: 'SF1234567890',
              originCode: '871',
              destCode: '755',
            },
          ],
        }),
      );

      const result = await svc.createOrder(baseParams);
      expect(result.waybillNo).toBe('SF1234567890');
      expect(result.sfOrderId).toBe('SF_ORDER_001');
      expect(result.originCode).toBe('871');
      expect(result.destCode).toBe('755');

      // 验证 fetch 被调用，且用了 UAT URL
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://sfapi-sbox.sf-express.com/std/service');
    });

    it('API 业务错误时抛 BadRequestException', async () => {
      const svc = createService();
      mockFetch.mockResolvedValueOnce(
        sfBusinessError('A1001', '签名校验失败'),
      );
      await expect(svc.createOrder(baseParams)).rejects.toThrow(
        '签名校验失败',
      );
    });

    it('HTTP 错误时抛 BadRequestException', async () => {
      const svc = createService();
      mockFetch.mockResolvedValueOnce(httpError(500));
      await expect(svc.createOrder(baseParams)).rejects.toThrow(
        'HTTP 500',
      );
    });

    it('网络错误时 bubble up', async () => {
      const svc = createService();
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(svc.createOrder(baseParams)).rejects.toThrow(
        'ECONNREFUSED',
      );
    });
  });

  // ─── cancelOrder ────────────────────────────────────

  describe('cancelOrder', () => {
    it('未配置时返回 success:false', async () => {
      const svc = createService({ SF_CLIENT_CODE: '' });
      const result = await svc.cancelOrder('o-001', 'SF1234567890');
      expect(result.success).toBe(false);
    });

    it('成功取消', async () => {
      const svc = createService();
      mockFetch.mockResolvedValueOnce(
        sfSuccess({ orderId: 'o-001', resStatus: 2 }),
      );
      const result = await svc.cancelOrder('o-001', 'SF1234567890');
      expect(result.success).toBe(true);
    });

    it('已取消订单再次取消视为幂等成功', async () => {
      const svc = createService();
      // 模拟顺丰返回"已取消"的业务错误
      mockFetch.mockResolvedValueOnce(
        sfBusinessError('A1001', '订单已取消，请勿重复操作 (8016)'),
      );
      const result = await svc.cancelOrder('o-001', 'SF1234567890');
      expect(result.success).toBe(true);
    });
  });

  // ─── queryRoutes ────────────────────────────────────

  describe('queryRoutes', () => {
    it('未配置时返回 null', async () => {
      const svc = createService({ SF_MONTHLY_ACCOUNT: '' });
      const result = await svc.queryRoutes('SF1234567890');
      expect(result).toBeNull();
    });

    it('成功返回路由且正确映射 opCode', async () => {
      const svc = createService();
      mockFetch.mockResolvedValueOnce(
        sfSuccess({
          routeResps: [
            {
              mailNo: 'SF1234567890',
              routes: [
                {
                  acceptTime: '2026-04-11 14:30:00',
                  remark: '已签收',
                  acceptAddress: '昆明市盘龙区',
                  opCode: '50',
                },
                {
                  acceptTime: '2026-04-11 10:00:00',
                  remark: '正在派送',
                  acceptAddress: '昆明市盘龙区翠湖路',
                  opCode: '31',
                },
                {
                  acceptTime: '2026-04-10 08:00:00',
                  remark: '已揽收',
                  acceptAddress: '玉溪市红塔区',
                  opCode: '10',
                },
              ],
            },
          ],
        }),
      );

      const result = await svc.queryRoutes('SF1234567890');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('DELIVERED'); // opCode 50 = 签收
      expect(result!.rawOpCode).toBe('50');
      expect(result!.events).toHaveLength(3);
      expect(result!.events[0].time).toBe('2026-04-11 14:30:00');
    });

    it('空路由列表时返回 null', async () => {
      const svc = createService();
      mockFetch.mockResolvedValueOnce(
        sfSuccess({
          routeResps: [
            {
              mailNo: 'SF1234567890',
              routes: [],
            },
          ],
        }),
      );
      const result = await svc.queryRoutes('SF1234567890');
      expect(result).toBeNull();
    });

    it('opCode 36（派件异常）映射为 EXCEPTION', async () => {
      const svc = createService();
      mockFetch.mockResolvedValueOnce(
        sfSuccess({
          routeResps: [
            {
              mailNo: 'SF1234567890',
              routes: [
                {
                  acceptTime: '2026-04-11 16:00:00',
                  remark: '派件异常',
                  opCode: '36',
                },
              ],
            },
          ],
        }),
      );
      const result = await svc.queryRoutes('SF1234567890');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('EXCEPTION');
    });
  });

  // ─── parsePushPayload ───────────────────────────────

  describe('parsePushPayload', () => {
    it('正常解析推送负载', () => {
      const svc = createService();
      const body = {
        msgData: JSON.stringify({
          waybillNo: 'SF1234567890',
          routeList: [
            {
              acceptTime: '2026-04-11 14:30:00',
              remark: '已签收',
              acceptAddress: '昆明市盘龙区',
              opCode: '50',
            },
          ],
        }),
      };

      const result = svc.parsePushPayload(body);
      expect(result).not.toBeNull();
      expect(result!.trackingNo).toBe('SF1234567890');
      expect(result!.status).toBe('DELIVERED');
      expect(result!.events).toHaveLength(1);
    });

    it('缺少 waybillNo 时返回 null', () => {
      const svc = createService();
      const body = {
        msgData: JSON.stringify({
          routeList: [
            {
              acceptTime: '2026-04-11 14:30:00',
              remark: '在途',
              opCode: '21',
            },
          ],
        }),
      };
      const result = svc.parsePushPayload(body);
      expect(result).toBeNull();
    });

    it('格式错误时返回 null', () => {
      const svc = createService();
      const body = {
        msgData: '{{not valid json',
      };
      const result = svc.parsePushPayload(body);
      expect(result).toBeNull();
    });
  });

  // ─── verifyPushSignature ────────────────────────────

  describe('verifyPushSignature', () => {
    it('正确签名通过验证', () => {
      const svc = createService();
      const bodyStr = '{"waybillNo":"SF1234567890"}';
      // 推送签名 = Base64(MD5(bodyString + checkWord))，无 timestamp
      const expected = crypto
        .createHash('md5')
        .update(bodyStr + 'test_check_word_secret', 'utf8')
        .digest('base64');

      expect(svc.verifyPushSignature(bodyStr, expected)).toBe(true);
    });

    it('错误签名被拒绝', () => {
      const svc = createService();
      const bodyStr = '{"waybillNo":"SF1234567890"}';
      expect(svc.verifyPushSignature(bodyStr, 'wrong_digest')).toBe(false);
    });

    it('缺少签名被拒绝', () => {
      const svc = createService();
      const bodyStr = '{"waybillNo":"SF1234567890"}';
      expect(svc.verifyPushSignature(bodyStr, undefined)).toBe(false);
    });
  });

  // ─── OP_CODE_MAP 静态映射 ──────────────────────────

  describe('OP_CODE_MAP', () => {
    it('包含所有关键 opCode 映射', () => {
      expect(SfExpressService.OP_CODE_MAP['50']).toBe('DELIVERED');
      expect(SfExpressService.OP_CODE_MAP['10']).toBe('SHIPPED');
      expect(SfExpressService.OP_CODE_MAP['31']).toBe('DELIVERING');
      expect(SfExpressService.OP_CODE_MAP['36']).toBe('EXCEPTION');
      expect(SfExpressService.OP_CODE_MAP['80']).toBe('EXCEPTION');
      expect(SfExpressService.OP_CODE_MAP['54']).toBe('EXCEPTION');
      expect(SfExpressService.OP_CODE_MAP['21']).toBe('IN_TRANSIT');
    });
  });
});
