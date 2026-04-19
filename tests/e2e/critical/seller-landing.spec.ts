import { test, expect } from '@playwright/test';

test.describe('L0 Smoke - 卖家后台', () => {
  test('OWNER 登录态复用，进入首页', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 登录态已由 storageState 注入，不应该再跳转到 /login
    expect(page.url()).not.toContain('/login');

    // 验证卖家 Layout 存在
    await expect(page.locator('.ant-layout, .ant-pro-layout').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
