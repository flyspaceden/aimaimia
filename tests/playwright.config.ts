import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const ADMIN_DIR = path.join(ROOT, 'admin');
const SELLER_DIR = path.join(ROOT, 'seller');

export const CAPTCHA_BYPASS_TOKEN = 'etest1'; // 6 字符，满足前端 4-6 位校验
export const ADMIN_STATE = path.join(__dirname, '.auth/admin.json');
export const SELLER_STATE = path.join(__dirname, '.auth/seller.json');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'test-results/html', open: 'never' }],
    ['list'],
  ],
  outputDir: 'test-results/artifacts',
  globalSetup: require.resolve('./e2e/global-setup'),

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'smoke',
      testMatch: /smoke\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' },
    },
    {
      name: 'admin',
      testMatch: /critical\/admin-.*\.spec\.ts|regression\/admin-.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173', storageState: ADMIN_STATE },
    },
    {
      name: 'seller',
      testMatch: /critical\/seller-.*\.spec\.ts|regression\/seller-.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5174', storageState: SELLER_STATE },
    },
    {
      // 跨端测试（C03/C04/C07 等）：测试内部用 browser.newContext 手动切换 admin/seller
      name: 'cross',
      testMatch: /critical\/c\d+-.*\.spec\.ts|cross-system\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: `NODE_ENV=test CAPTCHA_BYPASS_TOKEN=${CAPTCHA_BYPASS_TOKEN} npm run start:dev`,
      cwd: BACKEND_DIR,
      url: 'http://localhost:3000/api/v1/admin/auth/captcha',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev',
      cwd: ADMIN_DIR,
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      cwd: SELLER_DIR,
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
