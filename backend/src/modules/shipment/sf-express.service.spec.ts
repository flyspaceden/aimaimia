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
    SF_MONTHLY_ACCOUNT_UAT: '7551234567',
    SF_MONTHLY_ACCOUNT_PROD: '7551253482',
    SF_CALLBACK_URL: 'https://api.example.com/api/v1/shipments/sf/callback',
    // templateCode 启动期校验必须以 _<clientCode> 结尾
    SF_TEMPLATE_CODE: 'fm_150_standard_TEST_CLIENT',
    SF_ALLOW_E2E_MOCK: 'false',
    ...overrides,
  };
  const configService = {
    get: jest.fn(
      (key: string, defaultVal?: string) => config[key] ?? defaultVal ?? '',
    ),
  };
  return new SfExpressService(configService as any);
}

/** 构造顺丰 V2 协议成功响应（apiResultData 内含 success + msgData/obj） */
function sfSuccess(inner: any) {
  return {
    ok: true,
    json: async () => ({
      apiResultCode: 'A1000',
      apiErrorMsg: '',
      apiResultData: JSON.stringify({
        success: true,
        errorCode: 'S0000',
        errorMsg: null,
        ...(inner.obj || inner.files
          ? inner
          : { msgData: inner }),
      }),
    }),
  };
}

/** 构造协议层错误（apiResultCode != A1000） */
function sfBusinessError(code: string, msg: string) {
  return {
    ok: true,
    json: async () => ({
      apiResultCode: code,
      apiErrorMsg: msg,
      apiResultData: '',
    }),
  };
}

/** 构造业务层错误（success: false） */
function sfBizError(errorCode: string, errorMsg: string) {
  return {
    ok: true,
    json: async () => ({
      apiResultCode: 'A1000',
      apiErrorMsg: '',
      apiResultData: JSON.stringify({
        success: false,
        errorCode,
        errorMsg,
      }),
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
      const svc = createService({
        SF_MONTHLY_ACCOUNT_UAT: '',
        SF_MONTHLY_ACCOUNT_PROD: '',
      });
      expect(svc.isConfigured()).toBe(false);
    });
  });

  // ─── buildVerifyCode（标准 MD5：URLEncode + MD5 + Base64） ─────

  describe('buildVerifyCode', () => {
    /** Java URLEncoder 等价：与服务端实现保持一致 */
    function javaUrlEncode(s: string): string {
      return encodeURIComponent(s)
        .replace(/%20/g, '+')
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/~/g, '%7E');
    }

    it('对固定输入产生确定性输出（URLEncode → MD5 → Base64）', () => {
      const svc = createService();
      const msgData = '{"orderId":"test-001"}';
      const timestamp = '1712000000000';

      const raw = msgData + timestamp + 'test_check_word_secret';
      const encoded = javaUrlEncode(raw);
      const expected = crypto
        .createHash('md5')
        .update(encoded, 'utf8')
        .digest('base64');

      const result = svc.buildVerifyCode(msgData, timestamp);
      expect(result).toBe(expected);
      expect(result.length).toBeLessThanOrEqual(24);
    });

    it('包含中文/特殊字符时签名经 URL 编码（与服务端 Java URLEncoder 一致）', () => {
      const svc = createService();
      const msgData = '{"cargoDesc":"云南普洱茶 200g (特级)"}';
      const ts = '1712000000000';

      const result = svc.buildVerifyCode(msgData, ts);
      // 不经 URL 编码会得到不同结果（旧实现）
      const naive = crypto
        .createHash('md5')
        .update(msgData + ts + 'test_check_word_secret', 'utf8')
        .digest('base64');
      expect(result).not.toBe(naive);
    });

    it('不同输入产生不同签名', () => {
      const svc = createService();
      const ts = '1712000000000';
      const sig1 = svc.buildVerifyCode('{"a":1}', ts);
      const sig2 = svc.buildVerifyCode('{"b":2}', ts);
      expect(sig1).not.toBe(sig2);
    });
  });

  // ─── 启动期 templateCode 校验 ───────────────────────

  describe('templateCode 启动期校验', () => {
    it('templateCode 不以 _<clientCode> 结尾时启动失败', () => {
      expect(() =>
        createService({ SF_TEMPLATE_CODE: 'fm_150_standard_OTHER' }),
      ).toThrow(/必须以 _TEST_CLIENT 结尾/);
    });

    it('templateCode 为空时启动通过（运行时 printWaybill 才报错）', () => {
      expect(() =>
        createService({ SF_TEMPLATE_CODE: '' }),
      ).not.toThrow();
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
      const svc = createService({
        SF_MONTHLY_ACCOUNT_UAT: '',
        SF_MONTHLY_ACCOUNT_PROD: '',
      });
      const result = await svc.queryRoutes('SF1234567890');
      expect(result).toBeNull();
    });

    it('成功返回路由且正确映射 opCode（Bug 93 修订: 50=已收件→SHIPPED, 80=已签收→DELIVERED）', async () => {
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
                  opCode: '80',
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
                  opCode: '50',
                },
              ],
            },
          ],
        }),
      );

      const result = await svc.queryRoutes('SF1234567890');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('DELIVERED'); // opCode 80 = 已签收
      expect(result!.rawOpCode).toBe('80');
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

  // ─── parsePushPayload（沙箱实证 {Body:{WaybillRoute}} 格式，按 mailno 分组返数组）───

  describe('parsePushPayload', () => {
    it('单运单单事件解析（Bug 93 修订: 80=已签收→DELIVERED）', () => {
      const svc = createService();
      const body = {
        Body: {
          WaybillRoute: [
            {
              mailno: 'SF1234567890',
              acceptTime: '2026-04-11 14:30:00',
              remark: '已签收',
              acceptAddress: '昆明市盘龙区',
              opCode: '80',
              id: '1',
              orderid: 'O1',
            },
          ],
        },
      };

      const result = svc.parsePushPayload(body);
      expect(result).toHaveLength(1);
      expect(result[0].trackingNo).toBe('SF1234567890');
      expect(result[0].status).toBe('DELIVERED');
      expect(result[0].events).toHaveLength(1);
    });

    it('单运单多事件按 acceptTime 倒序，最新事件决定 status（Bug 93 修订）', () => {
      const svc = createService();
      const body = {
        Body: {
          WaybillRoute: [
            { mailno: 'SF1', acceptTime: '2026-04-10 10:00:00', remark: '揽收', opCode: '50', id: '1' },
            { mailno: 'SF1', acceptTime: '2026-04-11 14:30:00', remark: '已签收', opCode: '80', id: '2' },
          ],
        },
      };
      const result = svc.parsePushPayload(body);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('DELIVERED'); // opCode 80 是最新
      expect(result[0].events).toHaveLength(2);
      expect(result[0].events[0].opCode).toBe('80'); // 倒序排
    });

    it('多运单按 mailno 分组返多个 payload', () => {
      const svc = createService();
      const body = {
        Body: {
          WaybillRoute: [
            { mailno: 'SF1', acceptTime: '2026-04-11 10:00:00', remark: 'a', opCode: '10', id: '1' },
            { mailno: 'SF2', acceptTime: '2026-04-11 11:00:00', remark: 'b', opCode: '50', id: '2' },
            { mailno: 'SF1', acceptTime: '2026-04-11 12:00:00', remark: 'c', opCode: '21', id: '3' },
          ],
        },
      };
      const result = svc.parsePushPayload(body);
      expect(result).toHaveLength(2);
      const sf1 = result.find((p) => p.trackingNo === 'SF1');
      const sf2 = result.find((p) => p.trackingNo === 'SF2');
      expect(sf1?.events).toHaveLength(2);
      expect(sf2?.events).toHaveLength(1);
    });

    it('Body.WaybillRoute 为空返空数组', () => {
      const svc = createService();
      expect(svc.parsePushPayload({ Body: { WaybillRoute: [] } })).toEqual([]);
    });

    it('结构完全错误返空数组', () => {
      const svc = createService();
      expect(svc.parsePushPayload({ unrelated: true })).toEqual([]);
      expect(svc.parsePushPayload(null)).toEqual([]);
    });

    it('缺 mailno 的条目被过滤', () => {
      const svc = createService();
      const body = {
        Body: {
          WaybillRoute: [
            { mailno: 'SF1', acceptTime: '2026-04-11 10:00:00', remark: 'a', opCode: '10' },
            { mailno: '', acceptTime: '2026-04-11 11:00:00', remark: 'b', opCode: '50' },
          ],
        },
      };
      const result = svc.parsePushPayload(body);
      expect(result).toHaveLength(1);
      expect(result[0].trackingNo).toBe('SF1');
    });
  });

  // ─── verifyPushToken（Bug 87 — URL secret 路径模式） ───

  describe('verifyPushToken', () => {
    const PUSH_SECRET = 'a1b2c3d4e5f6789012345678abcdef00';

    it('未配置 SF_PUSH_SECRET 一律拒绝', () => {
      const svc = createService({ SF_PUSH_SECRET: '' });
      expect(svc.verifyPushToken(PUSH_SECRET)).toBe(false);
    });

    it('正确 token 通过', () => {
      const svc = createService({ SF_PUSH_SECRET: PUSH_SECRET });
      expect(svc.verifyPushToken(PUSH_SECRET)).toBe(true);
    });

    it('错误 token 拒绝', () => {
      const svc = createService({ SF_PUSH_SECRET: PUSH_SECRET });
      expect(svc.verifyPushToken('wrong_token')).toBe(false);
    });

    it('长度不等 token 拒绝（防 timingSafeEqual 异常）', () => {
      const svc = createService({ SF_PUSH_SECRET: PUSH_SECRET });
      expect(svc.verifyPushToken('short')).toBe(false);
    });

    it('空 token 拒绝', () => {
      const svc = createService({ SF_PUSH_SECRET: PUSH_SECRET });
      expect(svc.verifyPushToken('')).toBe(false);
    });
  });

  // ─── printWaybill ────────────────────────────────────

  describe('printWaybill', () => {
    it('未配置时抛出 BadRequestException', async () => {
      const service = createService({ SF_CHECK_WORD: '' });
      await expect(service.printWaybill('SF123')).rejects.toThrow(
        '顺丰丰桥服务未配置',
      );
    });

    it('成功返回 pdfUrl（沙箱实测路径 apiResultData.obj.files[0].url）', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce(sfSuccess({
        obj: {
          files: [{ url: 'https://oss-fbg.sf-express.com/print/abc.pdf?sign=xxx' }],
        },
      }));

      const result = await service.printWaybill('SF1234567890');
      expect(result.pdfUrl).toBe('https://oss-fbg.sf-express.com/print/abc.pdf?sign=xxx');
    });

    it('返回缺少 url 时抛出 BadRequestException', async () => {
      const service = createService();
      mockFetch.mockResolvedValueOnce(sfSuccess({ obj: { files: [] } }));
      await expect(service.printWaybill('SF123')).rejects.toThrow('面单打印失败');
    });

    it('templateCode 未配置时抛 BadRequestException', async () => {
      const service = createService({ SF_TEMPLATE_CODE: '' });
      await expect(service.printWaybill('SF123')).rejects.toThrow(
        'SF_TEMPLATE_CODE 未配置',
      );
    });
  });

  // ─── OP_CODE_MAP 静态映射 ──────────────────────────

  describe('OP_CODE_MAP（Bug 93 修订后）', () => {
    it('包含所有关键 opCode 映射', () => {
      // 已实证（SF 官方 PDF + 第三方多源印证）
      expect(SfExpressService.OP_CODE_MAP['50']).toBe('SHIPPED');     // 已收件/揽收
      expect(SfExpressService.OP_CODE_MAP['80']).toBe('DELIVERED');   // 已签收

      // 推断映射（待 SF 商务确认）
      expect(SfExpressService.OP_CODE_MAP['44']).toBe('DELIVERED');   // 代签
      expect(SfExpressService.OP_CODE_MAP['31']).toBe('IN_TRANSIT');  // 派件
      expect(SfExpressService.OP_CODE_MAP['36']).toBe('EXCEPTION');   // 派件异常
      expect(SfExpressService.OP_CODE_MAP['54']).toBe('EXCEPTION');   // 拒收/退回签收
      expect(SfExpressService.OP_CODE_MAP['99']).toBe('EXCEPTION');   // 退回

      // 留观（疑似当年抄错，保留以防回归）
      expect(SfExpressService.OP_CODE_MAP['10']).toBe('SHIPPED');
      expect(SfExpressService.OP_CODE_MAP['21']).toBe('IN_TRANSIT');
    });
  });
});
