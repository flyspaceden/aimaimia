import { Page } from '@playwright/test';

/**
 * 从页面 localStorage 提取 seller/admin JWT token
 * storageState 保存的是 cookies + localStorage，但 page.request 不会自动加 Authorization header
 */
export async function getAuthHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => {
    // 两端常见 localStorage key
    return (
      localStorage.getItem('seller_token') ||
      localStorage.getItem('admin_token') ||
      localStorage.getItem('token') ||
      localStorage.getItem('accessToken') ||
      ''
    );
  });
  return token ? { Authorization: `Bearer ${token}` } : {};
}
