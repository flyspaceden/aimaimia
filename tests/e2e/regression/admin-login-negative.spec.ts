import { test, expect } from '@playwright/test';
import { CAPTCHA_BYPASS_TOKEN } from '../../playwright.config';
import { collectConsoleErrors, filterFatalErrors } from '../helpers/console';

// 负面测试：登录 API 返回 401 是预期行为，过滤掉浏览器对 401 的 console 抱怨
function expectOnlyExpected401(errors: string[]) {
  const fatal = filterFatalErrors(errors).filter(
    (e) =>
      !/Failed to load resource.*401.*Unauthorized/.test(e) &&
      !/status of 401/.test(e),
  );
  expect(fatal, `Unexpected console errors:\n${fatal.join('\n')}`).toHaveLength(0);
}

/**
 * 管理后台登录负面路径回归测试
 *
 * 覆盖：
 *  - 错误密码
 *  - 错误验证码
 *  - 空字段前端校验
 *  - 不存在的用户名
 *  - 连续失败锁定（skip，避免污染其他测试）
 *
 * 注意：所有 test 均清空 storageState，模拟未登录状态。
 */

// 清空登录态，确保每个 test 从未登录开始
test.use({ storageState: { cookies: [], origins: [] } });

// 填写登录表单的辅助函数
async function fillLoginForm(
  page: import('@playwright/test').Page,
  opts: { username?: string; password?: string; captcha?: string },
) {
  if (opts.username !== undefined) {
    await page.locator('input[placeholder*="用户名"]').fill(opts.username);
  }
  if (opts.password !== undefined) {
    await page.locator('input[type="password"]').fill(opts.password);
  }
  if (opts.captcha !== undefined) {
    await page.locator('input[placeholder*="验证码"]').fill(opts.captcha);
  }
}

async function clickSubmit(page: import('@playwright/test').Page) {
  await page
    .locator('button[type="submit"], button:has-text("登 录"), button:has-text("登录")')
    .first()
    .click();
}

test.describe('L0 Regression - 管理后台登录负面路径', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);
  });

  test('Test 1: 错误密码应提示"用户名或密码错误"并停留在 /login', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await fillLoginForm(page, {
      username: 'admin',
      password: 'wrongpass',
      captcha: CAPTCHA_BYPASS_TOKEN,
    });

    const respPromise = page.waitForResponse((r) => r.url().includes('/admin/auth/login') && r.request().method() === 'POST');
    await clickSubmit(page);
    const resp = await respPromise;
    expect(resp.status()).toBe(401);
    const body = await resp.json().catch(() => ({}));
    expect(JSON.stringify(body)).toMatch(/用户名或密码错误/);
    await expect(page).toHaveURL(/\/login/);

    expectOnlyExpected401(getErrors());
  });

  test('Test 2: 错误验证码应提示"验证码错误或已过期"并停留 /login', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await fillLoginForm(page, {
      username: 'admin',
      password: '123456',
      captcha: 'abcdef',
    });

    const respPromise = page.waitForResponse((r) => r.url().includes('/admin/auth/login') && r.request().method() === 'POST');
    await clickSubmit(page);
    const resp = await respPromise;
    expect(resp.status()).toBe(401);
    const body = await resp.json().catch(() => ({}));
    expect(JSON.stringify(body)).toMatch(/验证码错误|验证码/);
    await expect(page).toHaveURL(/\/login/);

    expectOnlyExpected401(getErrors());
  });

  test('Test 3: 空字段直接提交触发前端 required 校验（不发请求）', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    // 监听请求：应无 /admin/auth/login 发出
    let loginRequestSent = false;
    page.on('request', (req) => {
      if (req.url().includes('/admin/auth/login')) {
        loginRequestSent = true;
      }
    });

    // 全部留空直接点击登录
    await clickSubmit(page);

    // antd Form.Item 的 required error 提示（三条）
    const errorLocator = page.locator('.ant-form-item-explain-error');
    await expect(errorLocator.first()).toBeVisible({ timeout: 5_000 });
    const count = await errorLocator.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // 等一小会儿，确认未发出登录请求
    await page.waitForTimeout(500);
    expect(loginRequestSent).toBe(false);
    await expect(page).toHaveURL(/\/login/);

    expectOnlyExpected401(getErrors());
  });

  test('Test 4: 不存在的用户名应提示"用户名或密码错误"（防枚举）', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    const ghostUser = `notexist_${Date.now()}`;
    await fillLoginForm(page, {
      username: ghostUser,
      password: '123456',
      captcha: CAPTCHA_BYPASS_TOKEN,
    });

    const respPromise = page.waitForResponse((r) => r.url().includes('/admin/auth/login') && r.request().method() === 'POST');
    await clickSubmit(page);
    const resp = await respPromise;
    expect(resp.status()).toBe(401);
    const body = await resp.json().catch(() => ({}));
    // 后端对"用户不存在"与"密码错误"返回相同文案，防枚举
    expect(JSON.stringify(body)).toMatch(/用户名或密码错误/);
    await expect(page).toHaveURL(/\/login/);

    expectOnlyExpected401(getErrors());
  });

  /**
   * Test 5: 连续 5 次错密码后账号锁定 30 分钟
   *
   * 跳过原因：该测试会污染 admin 账号登录态（锁定 30 分钟 / 或需 DB 重置 /
   * 等待 Cron 解锁），影响 setup project 以及后续 admin/seller project
   * 的所有测试。启用前需要：
   *   (a) 一个专用的测试管理员账号；或
   *   (b) 在 test.afterEach 中直接 SQL 重置 loginFailCount/lockedUntil；或
   *   (c) 独立的测试数据库 + 每次 reset。
   */
  test.skip('Test 5: 连续 5 次错密码后锁定账号 30 分钟', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    for (let i = 1; i <= 5; i++) {
      await page.goto('/login');
      await page.waitForLoadState('networkidle');
      await fillLoginForm(page, {
        username: 'admin',
        password: `wrong${i}`,
        captcha: CAPTCHA_BYPASS_TOKEN,
      });
      await clickSubmit(page);
      // 前 4 次：密码错误；第 5 次：触发锁定
      await page.waitForTimeout(800);
    }

    // 第 6 次用正确密码，应仍被锁定
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await fillLoginForm(page, {
      username: 'admin',
      password: '123456',
      captcha: CAPTCHA_BYPASS_TOKEN,
    });
    await clickSubmit(page);

    await expect(page.getByText(/账号已锁定/)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);

    expectOnlyExpected401(getErrors());
  });
});
