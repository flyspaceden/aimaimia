import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoFatalConsole } from '../helpers/console';

/**
 * C05 红包活动（平台优惠券）管理后台 smoke
 *
 * 权威概念：平台红包 = Coupon 体系（CouponCampaign / CouponInstance），
 * 与分润奖励 Reward 体系完全隔离（见 CLAUDE.md 架构决策）。
 *
 * 被测页面：/coupons/campaigns （admin/src/pages/coupons/campaigns.tsx）
 * 表单组件：campaign-form.tsx（Drawer + ProForm）
 *
 * 【降级说明】
 * 新建活动表单包含多个必填字段（活动名称、触发类型、发放方式、抵扣类型、
 * 抵扣值、总发放量、ProFormDateTimePicker 开始/结束时间等），DateTimePicker
 * 在 Playwright 下需要复杂的浮层交互，不稳定。本测试降级为：
 *   1) 列表页可见 + ProTable 渲染
 *   2) "新建活动" 按钮可见
 *   3) 点击按钮后抽屉打开并显示表单核心字段（活动名称输入框）
 * 完整的端到端创建流程留待后续用 API 直建 + UI 断言的混合方案覆盖。
 */
test.describe('L0 Smoke - C05 红包活动管理', () => {
  test('超管可进入红包活动列表并打开新建抽屉', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/coupons/campaigns');
    await page.waitForLoadState('networkidle');

    // 未被重定向到登录页
    expect(page.url()).not.toContain('/login');

    // Pro Layout 渲染
    await expect(page.locator('.ant-layout, .ant-pro-layout').first()).toBeVisible({
      timeout: 10_000,
    });

    // ProTable 标题 "红包活动管理"
    await expect(page.getByText('红包活动管理').first()).toBeVisible({ timeout: 10_000 });

    // 工具栏 "新建活动" 按钮
    const createBtn = page.getByRole('button', { name: /新建活动/ });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });

    // 点击打开抽屉
    await createBtn.click();

    // 抽屉标题
    await expect(page.getByText('新建红包活动').first()).toBeVisible({ timeout: 5_000 });

    // 表单核心字段：活动名称
    await expect(page.getByPlaceholder(/2026春节红包/)).toBeVisible({ timeout: 5_000 });

    // 分区标题：基本信息 / 抵扣规则 / 发放限制 / 活动时间
    await expect(page.getByText('基本信息').first()).toBeVisible();
    await expect(page.getByText('抵扣规则').first()).toBeVisible();
    await expect(page.getByText('发放限制').first()).toBeVisible();
    await expect(page.getByText('活动时间').first()).toBeVisible();

    expectNoFatalConsole(getErrors());
  });
});
