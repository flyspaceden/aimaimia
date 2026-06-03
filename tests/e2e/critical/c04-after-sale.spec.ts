import { test, expect } from '@playwright/test';
import { ADMIN_STATE } from '../../playwright.config';
import { collectConsoleErrors, expectNoFatalConsole } from '../helpers/console';

/**
 * C04 退换货端到端：管理员仲裁通过一条 UNDER_REVIEW 售后申请
 *
 * 流程：
 *   1. 造数据：使用种子中已有的售后单（backend/prisma/seed.ts 创建了 rr-001 ~ rr-005）
 *      其中 rr-002 初始状态为 UNDER_REVIEW（可仲裁），订单 o-009 / 用户 u-004。
 *   2. 管理端（超管，:5173）：
 *      - 进入 /after-sale
 *      - 搜索 id=rr-002 定位到该售后单（列表支持按 id 精确匹配）
 *      - 点击"仲裁"打开弹窗 → 选择"同意售后" → 点击"确认提交"
 *      - 断言仲裁按钮消失 / 状态 Tag 变为"已批准"
 *
 * 降级：
 *   - 若 rr-002 已被先前运行改成非可仲裁状态（APPROVED 等），
 *     回退挑选 UNDER_REVIEW Tab 下任意可仲裁行；若仍无，test.skip。
 *   - 该测试仅依赖 seed 数据，不需要额外造数 API。
 *
 * 依赖：
 *   - seed 已执行（AfterSaleRequest rr-002 存在）
 *   - 超管账号已通过 storageState 注入
 *   - cross project（配置里跨端测试默认不注入 storageState，本测试手动注入 ADMIN_STATE）
 */

const SEED_REQUEST_ID = 'rr-002'; // seed.ts 中 UNDER_REVIEW 状态的售后单

test.describe('C04 - 管理员退换货仲裁（通过）', () => {
  test('超管可对 UNDER_REVIEW 售后申请仲裁通过，状态变为已批准', async ({ browser }) => {
    const adminCtx = await browser.newContext({
      storageState: ADMIN_STATE,
      baseURL: 'http://localhost:5173',
    });
    const adminPage = await adminCtx.newPage();
    const getErrors = collectConsoleErrors(adminPage);

    try {
      // ---------- 1. 进入售后仲裁页 ----------
      await adminPage.goto('/after-sale');
      await adminPage.waitForLoadState('networkidle');
      expect(adminPage.url()).not.toContain('/login');

      await expect(
        adminPage.locator('.ant-pro-table, .ant-table').first(),
      ).toBeVisible({ timeout: 15_000 });

      // ---------- 2. 定位目标售后单 ----------
      // 优先用搜索框按 id 精确匹配（ProTable 搜索栏 label 即列标题"售后单号"）
      const idInput = adminPage.getByLabel('售后单号').first();
      let targetRow = adminPage.locator('.ant-table-row', { hasText: SEED_REQUEST_ID });
      let pickedFromSeed = false;

      if (await idInput.isVisible().catch(() => false)) {
        await idInput.fill(SEED_REQUEST_ID);
        await adminPage
          .getByRole('button', { name: /查\s*询|搜索/ })
          .first()
          .click();
        await adminPage.waitForLoadState('networkidle');
      }

      // 该行可能在"全部"Tab 能看到；若未找到（已被改状态），尝试切到"审核中"Tab
      // 关键：只有在"仲裁"按钮也可见时（即状态仍为 UNDER_REVIEW）才算命中
      const rowHasArbitrate =
        (await targetRow
          .first()
          .getByRole('button', { name: '仲裁' })
          .isVisible()
          .catch(() => false));

      let row = targetRow.first();
      if (rowHasArbitrate) {
        pickedFromSeed = true;
      } else {
        // 清空搜索并切到"审核中"Tab，找任意可仲裁行
        // ProTable 搜索栏"重置"按钮
        const resetBtn = adminPage
          .getByRole('button', { name: /^重\s*置$/ })
          .first();
        if (await resetBtn.isVisible().catch(() => false)) {
          await resetBtn.click();
          await adminPage.waitForLoadState('networkidle');
        }

        await adminPage.getByRole('tab', { name: /审核中/ }).first().click();
        await adminPage.waitForLoadState('networkidle');

        const fallbackRow = adminPage
          .locator('.ant-table-row')
          .filter({ has: adminPage.getByRole('button', { name: '仲裁' }) })
          .first();

        const hasFallback = await fallbackRow.isVisible().catch(() => false);
        if (!hasFallback) {
          await adminPage.screenshot({
            path: 'test-results/artifacts/c04-no-arbitrable.png',
            fullPage: true,
          });
          test.skip(
            true,
            'C04 降级跳过：seed 中 rr-002 已被先前运行仲裁，且"审核中"Tab 下无其它可仲裁售后单。TODO: 重置数据库或在 seed 中保留一条 UNDER_REVIEW 售后',
          );
          return;
        }
        row = fallbackRow;
      }

      // ---------- 3. 点击"仲裁"打开弹窗 ----------
      const arbitrateBtn = row.getByRole('button', { name: '仲裁' });
      await expect(arbitrateBtn).toBeVisible({ timeout: 10_000 });
      await arbitrateBtn.click();

      const modal = adminPage.locator('.ant-modal', { hasText: '售后仲裁' });
      await expect(modal).toBeVisible({ timeout: 10_000 });

      // ---------- 4. 选择"同意售后"并填入说明（走快捷模板） ----------
      // Radio.Group 默认就是 APPROVED，这里显式点一次确保状态正确
      await modal.getByLabel('同意售后').check().catch(async () => {
        // antd Radio 的 label 点击更稳定
        await modal.getByText('同意售后').click();
      });

      // 点击任意一个"质量问题"模板填入说明
      const tplBtn = modal.getByRole('button', { name: '质量问题' }).first();
      if (await tplBtn.isVisible().catch(() => false)) {
        await tplBtn.click();
      }

      // ---------- 5. 确认提交 ----------
      const arbitrateRespPromise = adminPage.waitForResponse(
        (r) =>
          r.url().includes('/admin/after-sale/') &&
          r.url().includes('/arbitrate') &&
          r.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await modal.getByRole('button', { name: '确认提交' }).click();

      const resp = await arbitrateRespPromise.catch(() => null);
      expect(
        resp && resp.status() >= 200 && resp.status() < 300,
        `仲裁接口失败: status=${resp?.status()} body=${await resp?.text().catch(() => '')}`,
      ).toBeTruthy();

      // ---------- 6. 断言：弹窗关闭 + 表格刷新后该行不再有仲裁按钮 ----------
      await expect(modal).toBeHidden({ timeout: 10_000 });

      // 若是 seed 行，通过搜索重新验证
      if (pickedFromSeed) {
        // ProTable actionRef.reload() 会自动刷新列表
        await adminPage.waitForLoadState('networkidle');
        const reloadedRow = adminPage
          .locator('.ant-table-row', { hasText: SEED_REQUEST_ID })
          .first();
        await expect(reloadedRow).toBeVisible({ timeout: 10_000 });

        // 状态 Tag 变为"已批准"（APPROVED 在 statusMaps 中映射为"已批准"）
        await expect(
          reloadedRow.locator('.ant-tag', { hasText: '已批准' }),
        ).toBeVisible({ timeout: 10_000 });

        // 该行不再有"仲裁"按钮
        await expect(reloadedRow.getByRole('button', { name: '仲裁' })).toHaveCount(0);
      } else {
        // fallback 行：只需验证顶部"已批准"统计卡片或列表中已批准数 > 0
        // 更简单：表格刷新后切到"已批准"Tab，应至少有一条记录
        await adminPage.getByRole('tab', { name: /已批准/ }).first().click();
        await adminPage.waitForLoadState('networkidle');
        await expect(
          adminPage.locator('.ant-tag', { hasText: '已批准' }).first(),
        ).toBeVisible({ timeout: 10_000 });
      }

      expectNoFatalConsole(getErrors());
    } finally {
      await adminCtx.close();
    }
  });
});
