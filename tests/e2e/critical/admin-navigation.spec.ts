import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoFatalConsole } from '../helpers/console';

/**
 * C06 替代：管理后台关键导航 smoke
 * 原计划 VIP 多档位管理页面尚未实现，暂用 VIP 系统配置页验证导航与权限
 */
test.describe('L0 Smoke - 管理后台导航', () => {
  test('超管可进入 VIP 系统配置页', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/bonus/vip-config');
    await page.waitForLoadState('networkidle');

    expect(page.url()).not.toContain('/login');
    await expect(page.locator('.ant-layout, .ant-pro-layout').first()).toBeVisible({
      timeout: 10_000,
    });

    expectNoFatalConsole(getErrors());
  });
});
