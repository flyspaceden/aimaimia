import { test as setup, expect } from '@playwright/test';
import { CAPTCHA_BYPASS_TOKEN } from '../playwright.config';
import path from 'path';
import fs from 'fs';

const AUTH_DIR = path.join(__dirname, '../.auth');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

export const ADMIN_STATE = path.join(AUTH_DIR, 'admin.json');
export const SELLER_STATE = path.join(AUTH_DIR, 'seller.json');

setup('authenticate admin', async ({ page }) => {
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');

  await page.locator('input[placeholder*="用户名"]').fill('admin');
  await page.locator('input[type="password"]').fill('123456');
  await page.locator('input[placeholder*="验证码"]').fill(CAPTCHA_BYPASS_TOKEN);
  await page.locator('button[type="submit"], button:has-text("登录")').first().click();

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
  await expect(page.locator('.ant-layout, .ant-pro-layout').first()).toBeVisible({ timeout: 10_000 });

  await page.context().storageState({ path: ADMIN_STATE });
});

setup('authenticate seller owner', async ({ page }) => {
  await page.goto('http://localhost:5174/login');
  await page.waitForLoadState('networkidle');

  // 切到"密码登录" tab（默认是短信登录）
  await page.locator('[role="tab"]:has-text("密码登录")').click();
  // 两个 tabpanel 同时存在于 DOM，只有 active 的是当前 tab，用 tabpanel[密码登录] 作用域
  const panel = page.locator('[role="tabpanel"][aria-labelledby*="密码登录"], [role="tabpanel"]').filter({ has: page.locator('input[placeholder="密码"]') }).first();

  await panel.locator('input[placeholder="手机号"]').fill('13800001001');
  await panel.locator('input[placeholder="密码"]').fill('123456');
  await panel.locator('input[placeholder*="图形验证码"]').fill(CAPTCHA_BYPASS_TOKEN);

  await panel.locator('button[type="submit"]:visible, button:has-text("登 录"):visible').first().click();

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });

  await page.context().storageState({ path: SELLER_STATE });
});
