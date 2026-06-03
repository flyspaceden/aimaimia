import { test, expect, Page } from '@playwright/test';
import { CAPTCHA_BYPASS_TOKEN } from '../../playwright.config';

/**
 * 卖家端角色权限矩阵 E2E
 *
 * 覆盖：
 *  - MANAGER (13800138003 @ c-001) 登录、菜单、API 权限
 *  - OPERATOR (13800138004 @ c-001) 登录、菜单、API 权限
 *
 * OWNER-only（基于代码分析）：
 *  - 前端菜单：/company/staff（员工管理）
 *  - 后端 API：POST/PUT/DELETE /seller/company/staff*、POST /seller/company/documents
 *
 * OWNER+MANAGER 可访问（OPERATOR 不可）：
 *  - 前端菜单：/analytics（数据报表）
 *  - 后端 API：POST /seller/products、batch-ship、after-sale 动作
 *
 * 本测试使用独立 Context（清空 storageState）避免复用 OWNER 登录态。
 */

// 清空 storageState（全 file 级别），每个 test 手动登录
test.use({ storageState: { cookies: [], origins: [] } });

const API_BASE = 'http://localhost:3000/api/v1';

/**
 * 通过前端 UI 登录（密码登录模式），完成后即具有 seller JWT localStorage。
 * 复用 auth.setup.ts 的选择器逻辑。
 */
async function loginAs(page: Page, phone: string, password: string) {
  await page.goto('http://localhost:5174/login');
  await page.waitForLoadState('networkidle');

  await page.locator('[role="tab"]:has-text("密码登录")').click();
  const panel = page
    .locator('[role="tabpanel"][aria-labelledby*="密码登录"], [role="tabpanel"]')
    .filter({ has: page.locator('input[placeholder="密码"]') })
    .first();

  await panel.locator('input[placeholder="手机号"]').fill(phone);
  await panel.locator('input[placeholder="密码"]').fill(password);
  await panel.locator('input[placeholder*="图形验证码"]').fill(CAPTCHA_BYPASS_TOKEN);

  await panel
    .locator('button[type="submit"]:visible, button:has-text("登 录"):visible')
    .first()
    .click();

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/**
 * 直接请求后端密码登录接口，拿 accessToken（用于 API 层测试）。
 * 先获取图形验证码 id（需要一次 Redis 记录），然后用 bypass token。
 */
async function apiLogin(
  request: ReturnType<typeof test.extend>['request'] extends (...args: any[]) => any
    ? any
    : any,
  phone: string,
  password: string,
): Promise<string> {
  // 获取 captcha（服务端返回 { captchaId, svg }）
  // 限流场景下最多重试 5 次（测试间可能触发 ThrottlerException）
  let captchaId = '';
  let cap: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    const capRes = await request.get(`${API_BASE}/seller/auth/captcha`);
    if (capRes.status() === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    cap = await capRes.json();
    captchaId = cap.captchaId || cap.data?.captchaId || cap.id || '';
    if (captchaId && captchaId.length < 100) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  expect(captchaId, `无法从 /seller/auth/captcha 解析 captchaId: ${JSON.stringify(cap).slice(0, 200)}`).toBeTruthy();

  // 限流场景下最多重试 5 次
  let loginRes: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    loginRes = await request.post(`${API_BASE}/seller/auth/login-by-password`, {
      data: { phone, password, captchaId, captchaCode: CAPTCHA_BYPASS_TOKEN },
    });
    if (loginRes.status() !== 429) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  expect(loginRes.ok(), `seller login failed: ${loginRes.status()} ${await loginRes.text()}`).toBe(true);
  const body = await loginRes.json();
  // 后端返回结构：{ accessToken, refreshToken, ... } 或 { data: { accessToken } }
  const accessToken: string = body.accessToken || body.data?.accessToken;
  expect(accessToken, 'accessToken missing in login response').toBeTruthy();
  return accessToken;
}

test.describe('L1 Seller - 角色权限矩阵', () => {
  test('MANAGER 能访问商品/订单/数据报表，看不到员工管理菜单', async ({ page }) => {
    await loginAs(page, '13800138003', '123456');

    // Layout 可见
    await expect(page.locator('.ant-pro-layout, .ant-layout').first()).toBeVisible({
      timeout: 10_000,
    });

    // /products 可进
    await page.goto('http://localhost:5174/products');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');
    expect(page.url()).toContain('/products');

    // /orders 可进
    await page.goto('http://localhost:5174/orders');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');
    expect(page.url()).toContain('/orders');

    // /analytics 可进（OWNER+MANAGER 允许）
    await page.goto('http://localhost:5174/analytics');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    // 侧边栏菜单不包含"员工管理"（OWNER-only）
    // 断言 DOM 中不存在 /company/staff 链接或"员工管理"菜单项
    const staffMenu = page.locator('.ant-pro-layout .ant-menu').getByText('员工管理', { exact: true });
    await expect(staffMenu).toHaveCount(0);
  });

  test('OPERATOR 登录后看不到"数据报表"和"员工管理"菜单', async ({ page }) => {
    await loginAs(page, '13800138004', '123456');

    await expect(page.locator('.ant-pro-layout, .ant-layout').first()).toBeVisible({
      timeout: 10_000,
    });

    // 基础页能进
    await page.goto('http://localhost:5174/products');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    // OPERATOR 不应看到"数据报表"菜单（roles: OWNER/MANAGER）
    const analyticsMenu = page
      .locator('.ant-pro-layout .ant-menu')
      .getByText('数据报表', { exact: true });
    await expect(analyticsMenu).toHaveCount(0);

    // OPERATOR 不应看到"员工管理"菜单（roles: OWNER）
    const staffMenu = page
      .locator('.ant-pro-layout .ant-menu')
      .getByText('员工管理', { exact: true });
    await expect(staffMenu).toHaveCount(0);
  });

  test('API 层：MANAGER 调用 OWNER-only 接口 (POST /seller/company/staff) 返回 403', async ({
    request,
  }) => {
    // 降低限流压力：每个 API 登录测试间隔 3 秒
    await new Promise((r) => setTimeout(r, 3000));
    const token = await apiLogin(request, '13800138003', '123456');

    const res = await request.post(`${API_BASE}/seller/company/staff`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        phone: '13900000001',
        role: 'OPERATOR',
        nickname: 'e2e-test-staff',
      },
    });

    // 应为 403（SellerRoleGuard 抛 ForbiddenException）
    expect(
      res.status(),
      `Expected 403 for MANAGER calling OWNER-only staff create, got ${res.status()}: ${await res.text()}`,
    ).toBe(403);
  });

  test('API 层：OPERATOR 调用 OWNER/MANAGER 接口 (POST /seller/products) 返回 403', async ({
    request,
  }) => {
    await new Promise((r) => setTimeout(r, 6000));
    const token = await apiLogin(request, '13800138004', '123456');

    // 商品创建要求 OWNER 或 MANAGER
    const res = await request.post(`${API_BASE}/seller/products`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title: 'e2e-operator-should-fail',
        categoryId: 'cat-001',
        description: 'this is an e2e forbidden test payload that should not succeed',
        cost: 10,
        stock: 1,
      },
    });

    expect(
      res.status(),
      `Expected 403 for OPERATOR calling OWNER/MANAGER product create, got ${res.status()}: ${await res.text()}`,
    ).toBe(403);
  });

  test('API 层：OPERATOR 调用 OWNER-only (GET /seller/company/staff) 返回 403', async ({
    request,
  }) => {
    const token = await apiLogin(request, '13800138004', '123456');

    const res = await request.get(`${API_BASE}/seller/company/staff`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(
      res.status(),
      `Expected 403 for OPERATOR listing staff, got ${res.status()}: ${await res.text()}`,
    ).toBe(403);
  });
});
