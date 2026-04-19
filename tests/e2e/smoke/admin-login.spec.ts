import { test, expect } from '@playwright/test';
import { CAPTCHA_BYPASS_TOKEN } from '../../playwright.config';
import { collectConsoleErrors, expectNoFatalConsole } from '../helpers/console';

test.describe('L0 Smoke - 管理后台登录', () => {
  test('超级管理员 admin/123456 登录成功', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/login/);

    await page.locator('input[placeholder*="用户名"]').fill('admin');
    await page.locator('input[type="password"]').fill('123456');
    await page.locator('input[placeholder*="验证码"]').fill(CAPTCHA_BYPASS_TOKEN);

    await page.screenshot({ path: 'test-results/artifacts/login-filled.png', fullPage: true });

    await page.locator('button[type="submit"], button:has-text("登录")').first().click();

    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: 'test-results/artifacts/landing.png', fullPage: true });

    await expect(page.locator('.ant-layout, .ant-pro-layout').first()).toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });
});
