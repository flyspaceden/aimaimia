import { SfExpressService } from './sf-express.service';

/**
 * Bug 93 — SF opCode 映射回归测试
 *
 * 防止 OP_CODE_MAP 又把 50 → DELIVERED / 80 → EXCEPTION 类型的关键映射改回去。
 * 真因：丰桥 PDF 实证 50=已收件/已派件（绝非签收）、80=已签收（确证 DELIVERED）。
 */

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
    SF_TEMPLATE_CODE: 'fm_150_standard_TEST_CLIENT',
    SF_ALLOW_E2E_MOCK: 'false',
    ...overrides,
  };
  const configService: any = {
    get: <T>(k: string, fallback?: T): T | string | undefined =>
      (config[k] as any) ?? fallback,
  };
  return new SfExpressService(configService);
}

describe('SfExpressService.OP_CODE_MAP', () => {
  it('opCode 50 必须映射 SHIPPED（已收件/揽收）— 防止又改回 DELIVERED 导致揽收即送达 bug', () => {
    expect(SfExpressService.OP_CODE_MAP['50']).toBe('SHIPPED');
  });

  it('opCode 80 必须映射 DELIVERED（已签收）— 防止又改回 EXCEPTION 导致签收事件被当异常', () => {
    expect(SfExpressService.OP_CODE_MAP['80']).toBe('DELIVERED');
  });

  it('opCode 44 代签 → DELIVERED（与 80 同语义）', () => {
    expect(SfExpressService.OP_CODE_MAP['44']).toBe('DELIVERED');
  });

  it('opCode 36 派件异常 / 99 退回 / 54 拒收 → EXCEPTION', () => {
    expect(SfExpressService.OP_CODE_MAP['36']).toBe('EXCEPTION');
    expect(SfExpressService.OP_CODE_MAP['99']).toBe('EXCEPTION');
    expect(SfExpressService.OP_CODE_MAP['54']).toBe('EXCEPTION');
  });

  it('opCode 30/31/60/70 在途类 → IN_TRANSIT', () => {
    expect(SfExpressService.OP_CODE_MAP['30']).toBe('IN_TRANSIT');
    expect(SfExpressService.OP_CODE_MAP['31']).toBe('IN_TRANSIT');
    expect(SfExpressService.OP_CODE_MAP['60']).toBe('IN_TRANSIT');
    expect(SfExpressService.OP_CODE_MAP['70']).toBe('IN_TRANSIT');
  });

  it('opCode 8000（订单结束）显式映射避免 warn 刷屏，实际无害（单调性保护守住）', () => {
    expect(SfExpressService.OP_CODE_MAP['8000']).toBe('IN_TRANSIT');
  });
});

describe('SfExpressService.parseWaybillRoutes 状态推导（Bug 93 集成）', () => {
  it('收到 opCode 50 路由推送时，整体状态为 SHIPPED（不是 DELIVERED）', () => {
    const svc = createService();
    const payloads = svc.parsePushPayload({
      Body: {
        WaybillRoute: [
          {
            mailno: 'SF7444703069240',
            acceptTime: '2026-05-06 10:11:26',
            acceptAddress: '深圳',
            remark: '已收件',
            opCode: '50',
            id: '111',
          },
        ],
      },
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].status).toBe('SHIPPED');
  });

  it('收到 opCode 80 路由推送时，整体状态为 DELIVERED', () => {
    const svc = createService();
    const payloads = svc.parsePushPayload({
      Body: {
        WaybillRoute: [
          {
            mailno: 'SF7444703069240',
            acceptTime: '2026-05-07 18:00:00',
            acceptAddress: '北京',
            remark: '已签收',
            opCode: '80',
            id: '222',
          },
        ],
      },
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].status).toBe('DELIVERED');
  });

  it('多条路由按时间倒序，最新事件 opCode 80 → DELIVERED（即使前面有 50）', () => {
    const svc = createService();
    const payloads = svc.parsePushPayload({
      Body: {
        WaybillRoute: [
          {
            mailno: 'SF7444703069240',
            acceptTime: '2026-05-06 10:11:26',
            opCode: '50',
            remark: '已揽件',
            id: '1',
          },
          {
            mailno: 'SF7444703069240',
            acceptTime: '2026-05-07 18:00:00',
            opCode: '80',
            remark: '已签收',
            id: '2',
          },
        ],
      },
    });
    expect(payloads[0].status).toBe('DELIVERED');
    expect(payloads[0].events).toHaveLength(2);
  });

  it('queryRoutes 显式按 acceptTime 倒序，SF API 乱序返回时仍取最新事件 opCode（Bug 93 加固）', async () => {
    const svc = createService();
    // mock callApi：模拟 SF API 返回时间乱序的 routes（实际事件顺序是 50→31→80，但 API 倒着返回）
    jest.spyOn(svc as any, 'callApi').mockResolvedValueOnce({
      msgData: {
        routeResps: [
          {
            mailNo: 'SF1234567890',
            // 故意乱序：把 50（最早）放第一条；之前漏 sort 时会取这个事件 → 错判 SHIPPED
            routes: [
              { acceptTime: '2026-04-10 08:00:00', remark: '已揽收', opCode: '50' },
              { acceptTime: '2026-04-12 18:00:00', remark: '已签收', opCode: '80' },
              { acceptTime: '2026-04-11 10:00:00', remark: '派件中', opCode: '31' },
            ],
          },
        ],
      },
    });
    const result = await svc.queryRoutes('SF1234567890');
    expect(result).not.toBeNull();
    // 修复后：显式 sort 取 acceptTime 最大的 80（已签收）
    expect(result!.status).toBe('DELIVERED');
    expect(result!.rawOpCode).toBe('80');
    // events 按倒序排列后，第一条应为最新签收事件
    expect(result!.events[0].opCode).toBe('80');
  });

  it('opCode 8000 单独推送（无 80/99 历史）→ IN_TRANSIT + 防御性 warn 提示 SF 异常', () => {
    const svc = createService();
    const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    const payloads = svc.parsePushPayload({
      Body: {
        WaybillRoute: [
          {
            mailno: 'SF7444703069240',
            acceptTime: '2026-05-07 10:00:00',
            opCode: '8000',
            remark: '订单结束',
            id: 'eol-1',
          },
        ],
      },
    });
    // 状态保持 IN_TRANSIT（不强行升级 DELIVERED 避免退回订单 false positive）
    expect(payloads[0].status).toBe('IN_TRANSIT');
    // 警告日志暴露 SF 异常行为
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('收到 8000(订单结束) 但历史无 80(签收)/99(退回)'),
    );
    warnSpy.mockRestore();
  });

  it('opCode 80 → 8000 完整正常签收流程：最新 8000 → IN_TRANSIT，但单调性保护下 Shipment.status 已是 DELIVERED 不会降级', () => {
    const svc = createService();
    const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    const payloads = svc.parsePushPayload({
      Body: {
        WaybillRoute: [
          {
            mailno: 'SF1',
            acceptTime: '2026-05-07 09:00:00',
            opCode: '80',
            remark: '已签收',
            id: '1',
          },
          {
            mailno: 'SF1',
            acceptTime: '2026-05-07 10:00:00',
            opCode: '8000',
            remark: '订单结束',
            id: '2',
          },
        ],
      },
    });
    // 最新事件是 8000 → IN_TRANSIT；但 handleSfCallback 单调性会拒降级（已 DELIVERED）
    expect(payloads[0].status).toBe('IN_TRANSIT');
    // 历史中有 80，不触发 warn
    const warnCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0] ?? '').includes('订单结束'),
    );
    expect(warnCalls).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('opCode 99 → 8000 退回流程：8000 不会强升 DELIVERED，避免退回订单 false positive', () => {
    const svc = createService();
    const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    const payloads = svc.parsePushPayload({
      Body: {
        WaybillRoute: [
          {
            mailno: 'SF1',
            acceptTime: '2026-05-07 09:00:00',
            opCode: '99',
            remark: '已退回',
            id: '1',
          },
          {
            mailno: 'SF1',
            acceptTime: '2026-05-07 10:00:00',
            opCode: '8000',
            remark: '订单结束',
            id: '2',
          },
        ],
      },
    });
    expect(payloads[0].status).toBe('IN_TRANSIT');
    // 历史中有 99 也不触发 warn
    const warnCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0] ?? '').includes('订单结束'),
    );
    expect(warnCalls).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('未知 opCode 回退到 IN_TRANSIT 并记录 warn 日志', () => {
    const svc = createService();
    const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    const payloads = svc.parsePushPayload({
      Body: {
        WaybillRoute: [
          {
            mailno: 'SF7444703069240',
            acceptTime: '2026-05-06 10:11:26',
            opCode: '9999',
            remark: '未知事件',
            id: 'x',
          },
        ],
      },
    });
    expect(payloads[0].status).toBe('IN_TRANSIT');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("未知 SF opCode '9999'"),
    );
    warnSpy.mockRestore();
  });
});
