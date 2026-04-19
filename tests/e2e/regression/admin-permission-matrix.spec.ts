import { test, expect, Page } from '@playwright/test';
import { CAPTCHA_BYPASS_TOKEN } from '../../playwright.config';
import { collectConsoleErrors, filterFatalErrors } from '../helpers/console';

/**
 * 管理后台角色权限矩阵 E2E
 *
 * ==== 方案选择：方案 A（种子多角色） ====
 * backend/prisma/seed.ts 中创建了 3 个管理端角色和对应用户：
 *   - 超级管理员（admin / 123456）—— 拥有全部权限（绕过权限检查）
 *   - 经理（manager / manager123）—— module 不以 'admin_' 开头的所有权限
 *       无 admin_users:* 和 admin_roles:* 权限
 *   - 员工（staff / staff123）—— 仅 dashboard:read / users:read / products:read
 *       /products:update / orders:read / companies:read / bonus:read / trace:read
 *       /config:read / audit:read
 *
 * 经理无权管理管理员账号；员工无权创建/编辑管理员，且仅 products 可写。
 * 因此采用方案 A：用经理和员工账号登录后验证菜单/UI 隐藏、API 层 403。
 * 同时补充未登录/无效 token 返回 401 的负面用例。
 *
 * 注意：
 *  - 前端权限码见 admin/src/constants/permissions.ts；后端装饰器 @RequirePermission
 *  - 管理员账号锁定（连续 5 次错密码）为 30 分钟，本文件不触发
 *  - 每轮 apiLogin 间 sleep ≥3s，限流 5/分钟（登录）+ 20/分钟（captcha）
 */

// 清空 storageState，避免复用超管 admin.json
test.use({ storageState: { cookies: [], origins: [] } });

const API_BASE = 'http://localhost:3000/api/v1';
const ADMIN_BASE = 'http://localhost:5173';

// ---------- helpers ----------

async function loginViaUi(page: Page, username: string, password: string) {
  await page.goto(`${ADMIN_BASE}/login`);
  await page.waitForLoadState('networkidle');

  // 与 smoke/admin-login.spec.ts 一致的简单选择器
  const captchaInput = page.locator('input[placeholder*="验证码"]');
  await captchaInput.waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('input[placeholder*="用户名"]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await captchaInput.click();
  await captchaInput.type(CAPTCHA_BYPASS_TOKEN, { delay: 30 });
  await page.waitForTimeout(300);

  await page
    .locator('button[type="submit"], button:has-text("登 录"), button:has-text("登录")')
    .first()
    .click();

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  // Layout 渲染完成
  await expect(page.locator('.ant-pro-layout, .ant-layout').first()).toBeVisible({
    timeout: 10_000,
  });
}

async function apiLogin(
  request: any,
  username: string,
  password: string,
): Promise<string> {
  // 获取 captcha，限流下最多重试 10 次
  let captchaId = '';
  let capRaw: any = {};
  for (let attempt = 0; attempt < 10; attempt++) {
    const capRes = await request.get(`${API_BASE}/admin/auth/captcha`);
    if (capRes.status() === 429) {
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }
    capRaw = await capRes.json().catch(() => ({}));
    captchaId = capRaw.captchaId || capRaw.data?.captchaId || capRaw.id || '';
    if (captchaId && captchaId.length < 100) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  expect(
    captchaId,
    `无法从 /admin/auth/captcha 解析 captchaId: ${JSON.stringify(capRaw || {}).slice(0, 200)}`,
  ).toBeTruthy();

  let loginRes: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    loginRes = await request.post(`${API_BASE}/admin/auth/login`, {
      data: { username, password, captchaId, captchaCode: CAPTCHA_BYPASS_TOKEN },
    });
    if (loginRes.status() !== 429) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  expect(
    loginRes.ok(),
    `admin login failed (${username}): ${loginRes.status()} ${await loginRes.text()}`,
  ).toBe(true);
  const body = await loginRes.json();
  const accessToken: string = body.accessToken || body.data?.accessToken;
  expect(accessToken, 'accessToken missing in admin login response').toBeTruthy();
  return accessToken;
}

// 负面测试：403/401 会被浏览器记录为 console error，过滤掉预期的
function expectOnlyExpectedAuthErrors(errors: string[]) {
  const fatal = filterFatalErrors(errors).filter(
    (e) =>
      !/Failed to load resource.*(401|403)/.test(e) &&
      !/status of (401|403)/.test(e) &&
      !/Unauthorized|Forbidden/i.test(e),
  );
  expect(fatal, `Unexpected console errors:\n${fatal.join('\n')}`).toHaveLength(0);
}

// ---------- tests ----------

test.describe('L1 Admin - 角色权限矩阵', () => {
  test('经理（manager）登录后看不到"管理员账号"和"角色权限"菜单', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await loginViaUi(page, 'manager', 'manager123');

    // 展开"系统管理"父菜单后断言 管理员账号/角色权限 两个子菜单项不存在
    const sysMenu = page.getByRole('menuitem', { name: /系统管理/ });
    if (await sysMenu.count() > 0) {
      await sysMenu.first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
    await expect(
      page.locator('.ant-menu').getByText('管理员账号', { exact: true }),
      '经理不应看到"管理员账号"子菜单',
    ).toHaveCount(0);
    await expect(
      page.locator('.ant-menu').getByText('角色权限', { exact: true }),
      '经理不应看到"角色权限"子菜单',
    ).toHaveCount(0);

    // 正向检查（"订单管理"等子菜单在 ProLayout 折叠态下不渲染到 DOM）
    // 改为断言登录成功 + 顶部菜单"交易与售后"父菜单可见
    await expect(page.getByRole('menuitem', { name: /交易与售后/ })).toBeVisible({
      timeout: 5_000,
    });

    expectOnlyExpectedAuthErrors(getErrors());
  });

  test('员工（staff）登录后看不到管理员账号/角色权限/红包/抽奖菜单', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await loginViaUi(page, 'staff', 'staff123');

    // 展开多个父菜单后断言敏感子菜单项均不存在
    for (const parent of [/系统管理/, /运营活动/]) {
      const menu = page.getByRole('menuitem', { name: parent });
      if (await menu.count() > 0) {
        await menu.first().click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    for (const label of ['管理员账号', '角色权限', '红包管理', '抽奖管理']) {
      const item = page.locator('.ant-menu').getByText(label, { exact: true });
      await expect(item, `员工不应看到菜单项"${label}"`).toHaveCount(0);
    }

    // 员工登录后至少能看到顶部"用户与奖励"父菜单（staff 有 users:read 权限）
    await expect(page.getByRole('menuitem', { name: /用户与奖励/ })).toBeVisible({
      timeout: 5_000,
    });

    expectOnlyExpectedAuthErrors(getErrors());
  });

  // TODO: admin login 限流导致不稳定（本地限流窗口长，测试间隔不足）。skip until rate-limit harness ready
  test('API 层：经理调用 admin_users:create 接口应返回 403', async ({ request }) => {
    test.setTimeout(120_000);

    const token = await apiLogin(request, 'manager', 'manager123');

    // POST /admin/users 需要 admin_users:create，经理没有
    const res = await request.post(`${API_BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        username: `e2e_forbidden_${Date.now()}`,
        password: 'abc12345',
        realName: 'E2E Forbidden',
        roleIds: [],
      },
    });

    expect(
      res.status(),
      `Expected 403 for manager calling admin_users:create, got ${res.status()}: ${await res.text()}`,
    ).toBe(403);
  });

  test('API 层：员工调用 admin_users:read 接口应返回 403', async ({ request }) => {
    test.setTimeout(120_000);

    const token = await apiLogin(request, 'staff', 'staff123');

    const res = await request.get(`${API_BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(
      res.status(),
      `Expected 403 for staff listing admin users, got ${res.status()}: ${await res.text()}`,
    ).toBe(403);
  });

  test('API 层：员工调用 admin_roles:read 接口应返回 403', async ({ request }) => {
    await new Promise((r) => setTimeout(r, 6000));
    const token = await apiLogin(request, 'staff', 'staff123');

    const res = await request.get(`${API_BASE}/admin/roles`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(
      res.status(),
      `Expected 403 for staff listing admin roles, got ${res.status()}: ${await res.text()}`,
    ).toBe(403);
  });

  test('API 层：未登录（无 Authorization 头）调用受保护接口返回 401', async ({ request }) => {
    const res = await request.get(`${API_BASE}/admin/users`);
    expect(
      res.status(),
      `Expected 401 for unauthenticated request, got ${res.status()}: ${await res.text()}`,
    ).toBe(401);
  });

  test('API 层：无效/篡改 Bearer token 调用受保护接口返回 401', async ({ request }) => {
    // 明显非法 token（签名无效）
    const res = await request.get(`${API_BASE}/admin/users`, {
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    });
    expect(
      res.status(),
      `Expected 401 for invalid token, got ${res.status()}: ${await res.text()}`,
    ).toBe(401);
  });
});
