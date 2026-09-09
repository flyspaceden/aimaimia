import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// 纯界面回归使用受控 API fixture，不读取用户浏览器，也不连接真实后台。
export default defineConfig({
  testDir: './fund-pages',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/fund-pages',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5189', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5189 --strictPort', cwd: path.resolve(__dirname, '../admin'), url: 'http://127.0.0.1:5189', reuseExistingServer: false, timeout: 60000 },
});
