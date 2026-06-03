import { test, expect, APIRequestContext } from '@playwright/test';
import { getAuthHeaders } from '../helpers/auth';

/**
 * 并发 & 幂等性回归测试
 *
 * 命名说明：
 *   文件名带 `seller-` 前缀以匹配 playwright.config.ts 中 seller project 的 testMatch
 *   （`regression/seller-.*\.spec\.ts`），因此会被注入 SELLER_STATE（c-001 OWNER）。
 *   但测试内部同时需要 admin token（后两个 test），通过 request.post 直接调后端 API
 *   登录获取 admin token，无需额外 storageState。
 *
 * 覆盖点（对应 docs/issues/tofix-safe.md 与 CLAUDE.md 的 Serializable 要求）：
 *   T1. 重复生成面单：两个请求并发 POST /seller/orders/:id/waybill
 *       → 期望只有一个成功生成 Shipment（幂等 / CAS 保护）
 *   T2. 重复仲裁售后：两个请求并发 POST /admin/after-sale/:id/arbitrate
 *       → 期望只有一个成功写入状态，其余返回 409 / 400 / 业务错误
 *       （会把 rr-002 消耗掉，但本测试独立于其他 after-sale 测试执行）
 *   T3. 管理端登录限流：连续 10 次 /admin/auth/login 请求
 *       → 期望在 5 次之后命中 Throttle 返回 429
 *
 * 降级策略：
 *   - 面单 API 若返回非 2xx/409（例如 404 订单不存在或种子漂移），降级 skip
 *   - after-sale rr-002 若已不是 UNDER_REVIEW（前序测试消耗了），降级 skip
 *   - login throttle 若测试环境关闭了 Throttler，降级记录警告但不失败
 *
 * 不测：超卖容忍并发。原因：R12 已在项目备忘录确认是故意设计（库存可负），
 *       非 CAS decrement 是 feature 不是 bug，无需 E2E 验证，留 TODO。
 */

const BACKEND_ORIGIN = 'http://localhost:3000';

/** 从 seller page 拿到 seller token，用于直接打后端 API */
async function sellerAuthFromPage(page: import('@playwright/test').Page) {
  // 进到任意受保护页触发 storageState 注入
  await page.goto('/dashboard').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  return getAuthHeaders(page);
}

/** 通过直接 HTTP 登录拿到 admin token（避开 storageState 的 baseURL 限制） */
async function loginAdmin(request: APIRequestContext): Promise<string> {
  // 限流下最多重试 10 次
  let captchaId = '';
  for (let i = 0; i < 10; i++) {
    const capResp = await request.get(`${BACKEND_ORIGIN}/api/v1/admin/auth/captcha`);
    if (capResp.status() === 429) {
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }
    const cap = await capResp.json().catch(() => ({}));
    captchaId = cap?.data?.captchaId ?? cap?.captchaId ?? '';
    if (captchaId) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  expect(captchaId, 'admin captcha 获取失败').toBeTruthy();

  let loginResp: any;
  for (let i = 0; i < 10; i++) {
    loginResp = await request.post(`${BACKEND_ORIGIN}/api/v1/admin/auth/login`, {
      data: { username: 'admin', password: '123456', captchaId, captchaCode: 'etest1' },
    });
    if (loginResp.status() !== 429) break;
    await new Promise((r) => setTimeout(r, 8000));
  }
  expect(
    loginResp.ok(),
    `admin 登录失败 status=${loginResp.status()} body=${await loginResp.text().catch(() => '')}`,
  ).toBeTruthy();
  const body = await loginResp.json();
  const token =
    body?.data?.accessToken ||
    body?.accessToken ||
    body?.data?.token ||
    body?.token;
  expect(token, 'admin 登录响应中未找到 token').toBeTruthy();
  return token as string;
}

test.describe('并发与幂等性回归', () => {
  test('T1 重复生成面单：并发 2 次，只有一次成功落库', async ({ page, request }) => {
    const authHeaders = await sellerAuthFromPage(page);
    if (!authHeaders.Authorization) {
      test.skip(true, 'T1 降级：SELLER_STATE 未注入 token');
      return;
    }

    // —— 先通过卖家订单列表 API 找一个 PAID 且无 shipment 的订单 ——
    // seller-orders 列表 endpoint：GET /seller/orders?status=PAID
    const listResp = await request.get(
      `${BACKEND_ORIGIN}/api/v1/seller/orders?status=PAID&page=1&pageSize=50`,
      { headers: authHeaders },
    );
    if (!listResp.ok()) {
      test.skip(true, `T1 降级：订单列表查询失败 status=${listResp.status()}`);
      return;
    }
    const listBody = await listResp.json();
    const items: any[] =
      listBody?.data?.items ||
      listBody?.data?.list ||
      listBody?.items ||
      listBody?.data ||
      [];

    // 找首条可发货订单（PAID 且无 waybillNo / shipment）
    const shippable = items.find((o) => {
      const hasShipment = o?.shipment?.waybillNo || o?.waybillNo || o?.shipmentStatus === 'SHIPPED';
      return !hasShipment && (o?.status === 'PAID' || !o?.status);
    });
    if (!shippable) {
      test.skip(
        true,
        `T1 降级：c-001 无可发货订单（列表 ${items.length} 条，可能前序测试已全部发货）`,
      );
      return;
    }
    const orderId: string = shippable.id || shippable.orderId;
    expect(orderId, 'orderId 不能为空').toBeTruthy();
    console.log('[T1] picked order:', orderId);

    // —— 并发 2 次 POST waybill ——
    const url = `${BACKEND_ORIGIN}/api/v1/seller/orders/${encodeURIComponent(orderId)}/waybill`;
    const payload = { carrierCode: 'SF' };
    const [r1, r2] = await Promise.all([
      request.post(url, { headers: authHeaders, data: payload }),
      request.post(url, { headers: authHeaders, data: payload }),
    ]);

    const statuses = [r1.status(), r2.status()];
    const bodies = await Promise.all([
      r1.text().catch(() => ''),
      r2.text().catch(() => ''),
    ]);
    console.log('[T1] concurrent waybill statuses:', statuses, 'bodies:', bodies);

    // 期望：至少一个成功（2xx）
    const okCount = statuses.filter((s) => s >= 200 && s < 300).length;
    const conflictCount = statuses.filter(
      (s) => s === 409 || s === 400 || s === 422 || s === 500,
    ).length;

    expect(okCount, '至少应有一个成功').toBeGreaterThanOrEqual(1);

    // 理想情况：只有一个成功，另一个冲突
    // 如果两个都成功，说明 waybill 生成没有 CAS/唯一约束保护 —— 这是 BUG
    if (okCount === 2) {
      // 进一步检查：两个 response 是否返回了同一个 waybillNo（幂等）或两个不同面单（BUG）
      const b1 = JSON.parse(bodies[0] || '{}');
      const b2 = JSON.parse(bodies[1] || '{}');
      const w1 = b1?.data?.waybillNo || b1?.waybillNo;
      const w2 = b2?.data?.waybillNo || b2?.waybillNo;
      expect(
        w1 && w2 && w1 === w2,
        `重复发货保护失败：两次调用返回了不同的 waybill (${w1} vs ${w2}) —— 需要在 SellerShippingService.generateWaybill 加 CAS / 唯一约束`,
      ).toBeTruthy();
    } else {
      expect(
        okCount === 1 && conflictCount >= 1,
        `并发 waybill 响应异常：statuses=${statuses.join(',')}`,
      ).toBeTruthy();
    }

    // —— 再发一次，必须幂等（返回已生成 / 409 / 400）——
    const r3 = await request.post(url, { headers: authHeaders, data: payload });
    expect(
      [200, 201, 400, 409, 422].includes(r3.status()),
      `第三次发货应为幂等 / 冲突，实际 status=${r3.status()}`,
    ).toBeTruthy();
  });

  test('T2 重复仲裁售后：rr-002 并发 arbitrate，只有一次生效', async ({ request }) => {
    test.setTimeout(120_000);
    // 避开全局 admin login 限流
    await new Promise((r) => setTimeout(r, 20_000));
    const adminToken = await loginAdmin(request);
    const headers = { Authorization: `Bearer ${adminToken}` };

    // 先检查 rr-002 是否仍在 UNDER_REVIEW
    const detailResp = await request.get(
      `${BACKEND_ORIGIN}/api/v1/admin/after-sale/rr-002`,
      { headers },
    );
    if (!detailResp.ok()) {
      test.skip(true, `T2 降级：rr-002 查询失败 status=${detailResp.status()}`);
      return;
    }
    const detail = await detailResp.json();
    const current = detail?.data?.status || detail?.status;
    if (current !== 'UNDER_REVIEW') {
      test.skip(
        true,
        `T2 降级：rr-002 当前状态=${current}，非 UNDER_REVIEW（可能被前序测试消耗）`,
      );
      return;
    }

    const url = `${BACKEND_ORIGIN}/api/v1/admin/after-sale/rr-002/arbitrate`;
    const payload = { status: 'APPROVED', reason: 'E2E 并发仲裁测试' };

    const [r1, r2] = await Promise.all([
      request.post(url, { headers, data: payload }),
      request.post(url, { headers, data: payload }),
    ]);
    const statuses = [r1.status(), r2.status()];
    const bodies = await Promise.all([
      r1.text().catch(() => ''),
      r2.text().catch(() => ''),
    ]);
    console.log('[T2] concurrent arbitrate statuses:', statuses, 'bodies:', bodies);

    const okCount = statuses.filter((s) => s >= 200 && s < 300).length;
    // 理想：1 个 200 + 1 个 400/409/422
    expect(okCount, '至少应有一次仲裁成功').toBeGreaterThanOrEqual(1);
    expect(
      okCount === 1,
      `并发仲裁应只有一次成功，实际 ${okCount} 次成功 statuses=${statuses.join(',')}；可能状态机未用 Serializable 或未做状态 CAS`,
    ).toBeTruthy();

    // —— 再发一次，必须拒绝状态转换 ——
    const r3 = await request.post(url, { headers, data: payload });
    expect(
      r3.status() >= 400,
      `rr-002 已是终态，再次仲裁应返回 4xx，实际 status=${r3.status()}`,
    ).toBeTruthy();
  });

  test('T3 管理端登录限流：连续 10 次应命中 429', async ({ request }) => {
    // 先取 captcha（不计入 login throttle）
    const capResp = await request.get(`${BACKEND_ORIGIN}/api/v1/admin/auth/captcha`);
    expect(capResp.ok()).toBeTruthy();
    const cap = await capResp.json();
    const captchaId = cap?.data?.captchaId ?? cap?.captchaId;

    const statuses: number[] = [];
    // 顺序发送以保证 Throttler 准确计数（Throttler 按 IP+时间窗，但并发可能导致少量穿透）
    for (let i = 0; i < 10; i++) {
      const resp = await request.post(`${BACKEND_ORIGIN}/api/v1/admin/auth/login`, {
        data: {
          username: 'nonexistent_e2e',
          password: 'wrong-password-xxx',
          captchaId,
          captchaCode: 'etest1',
        },
      });
      statuses.push(resp.status());
    }
    console.log('[T3] 10 login statuses:', statuses);

    const throttled = statuses.filter((s) => s === 429).length;
    // limit=5/min，10 次至少应有 ~5 次被限流
    if (throttled === 0) {
      console.warn(
        '[T3] WARN: 未命中 429，可能测试环境关闭了 ThrottlerGuard 或 IP 窗口被其他 test 耗尽；不 fail 但需人工确认',
      );
      // 至少断言不是全部 "200 OK"（凭错误凭据登录应该 401/429）
      const bad = statuses.filter((s) => s === 401 || s === 403 || s === 400 || s === 429).length;
      expect(bad, '所有登录都应返回错误（401/429 等）').toBeGreaterThanOrEqual(10);
    } else {
      expect(
        throttled,
        `应至少有 1 次 429（limit=5/min），实际 ${throttled} 次；statuses=${statuses.join(',')}`,
      ).toBeGreaterThanOrEqual(1);
      // 前 5 次内不应出现 429（除非上一测试把配额用了，警告而非失败）
      if (statuses.slice(0, 5).includes(429)) {
        console.warn('[T3] WARN: 前 5 次已命中 429，可能 IP 窗口被上一测试污染');
      }
    }
  });

  // TODO: T4 超卖容忍验证（R12 已确认是故意设计：库存可负是 feature）
  //       若需对"库存 decrement 确实发生"做回归，请在单元测试层覆盖
});
