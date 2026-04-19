import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoFatalConsole } from '../helpers/console';

/**
 * C01 商户入驻审核
 * 流程：
 *   1. 通过公开 API 创建一条 PENDING 入驻申请（使用 CAPTCHA_BYPASS_TOKEN 绕过验证码）
 *   2. 超管进入 /companies 页面 → 切换到「入驻申请」Tab
 *   3. 找到刚创建的申请记录 → 点击「通过」→ 确认弹窗
 *   4. 断言列表里该行状态由「待审核」变为「已通过」
 *
 * 依赖：
 *   - 后端以 NODE_ENV=test + CAPTCHA_BYPASS_TOKEN=etest1 启动
 *   - 超管账号已通过 storageState 注入（admin project）
 *   - 不依赖种子数据，测试自己通过 public API 造数据
 */

const BACKEND_ORIGIN = 'http://localhost:3000';
const CAPTCHA_BYPASS = 'etest1';

// 最小有效 PNG（1x1 透明像素），保证 magic bytes 校验通过
const MIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// 生成唯一的公司名与手机号，避免与之前测试数据冲突
function uniqueSuffix(): string {
  return `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
}

function randomMobile(): string {
  // 138 开头 + 8 位随机数字，确保满足 zh-CN 手机号校验
  const tail = Math.floor(10000000 + Math.random() * 89999999).toString();
  return `138${tail}`;
}

test.describe('C01 - 管理后台商户入驻审核', () => {
  test('超管可在「入驻申请」Tab 通过一条待审商户', async ({ page, request }) => {
    const getErrors = collectConsoleErrors(page);

    // ---------- 1. 造数据：通过公开 API 创建 PENDING 申请 ----------
    const suffix = uniqueSuffix();
    const companyName = `E2E商户_${suffix}`;
    const contactName = `E2E联系人_${suffix}`;
    const phone = randomMobile();

    const pngBuffer = Buffer.from(MIN_PNG_BASE64, 'base64');

    const createResp = await request.post(
      `${BACKEND_ORIGIN}/api/v1/merchant-applications`,
      {
        multipart: {
          companyName,
          category: '水果生鲜',
          contactName,
          phone,
          captchaId: 'e2e-bypass',
          captchaCode: CAPTCHA_BYPASS,
          licenseFile: {
            name: 'license.png',
            mimeType: 'image/png',
            buffer: pngBuffer,
          },
        },
      },
    );

    // 创建接口对已存在的 PENDING 返回 200 但内部可能不落库；
    // 我们用全新随机手机号 + 公司名，应视为新建成功
    expect(
      createResp.ok(),
      `创建入驻申请失败: ${createResp.status()} ${await createResp.text().catch(() => '')}`,
    ).toBeTruthy();

    // ---------- 2. 进入企业管理页，切换到「入驻申请」Tab ----------
    await page.goto('/companies');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    // 侧边 Layout 应存在
    await expect(page.locator('.ant-layout, .ant-pro-layout').first()).toBeVisible({
      timeout: 10_000,
    });

    // 切换到「入驻申请」Tab
    await page.getByRole('tab', { name: /入驻申请/ }).click();

    // 等待表格加载出刚创建的申请记录
    const row = page.locator('.ant-table-row', { hasText: companyName });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // 该行初始状态应为「待审核」
    await expect(row.locator('.ant-tag', { hasText: '待审核' })).toBeVisible();

    // ---------- 3. 点击「通过」按钮，确认弹窗 ----------
    await row.getByRole('button', { name: /通过$/ }).click();

    // 弹出确认 Modal
    const approveModal = page.locator('.ant-modal', {
      hasText: '确认通过入驻申请',
    });
    await expect(approveModal).toBeVisible();
    await approveModal.getByRole('button', { name: '确认通过' }).click();

    // ---------- 4. 断言：该行状态变为「已通过」----------
    // 不依赖 toast（可能已自动关闭），直接断言 Tag 变更
    // ProTable 会自动 reload，等状态 Tag 更新
    const updatedRow = page.locator('.ant-table-row', { hasText: companyName });
    await expect(updatedRow.locator('.ant-tag', { hasText: '已通过' })).toBeVisible({
      timeout: 10_000,
    });

    // 不再有「通过/拒绝」操作按钮
    await expect(updatedRow.getByRole('button', { name: /通过$/ })).toHaveCount(0);

    expectNoFatalConsole(getErrors());
  });
});
