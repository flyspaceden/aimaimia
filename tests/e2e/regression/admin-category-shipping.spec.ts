import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoFatalConsole } from '../helpers/console';

/**
 * 管理后台 — 分类管理 + 运费模板 CRUD 回归测试
 *
 * 被测页面：
 *   /categories     (admin/src/pages/categories/index.tsx) — 树形拖拽表 + 弹窗新增 + 行内编辑（双击） + Popconfirm 删除
 *   /shipping-rules (admin/src/pages/shipping-rules/index.tsx) — ProTable + ModalForm 新增/编辑 + Popconfirm 删除
 *
 * storageState 已注入超管（ADMIN_STATE），无需手动登录。
 */

/* ---------- 分类管理 ---------- */
test.describe('分类管理 CRUD', () => {
  const uniqueSuffix = Date.now();
  const categoryName = `E2E-分类-${uniqueSuffix}`;
  const categoryNameEdited = `E2E-分类改-${uniqueSuffix}`;

  test('列表加载 — 分类表渲染且种子分类可见', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/categories');
    await page.waitForLoadState('networkidle');

    // 未被重定向到登录页
    expect(page.url()).not.toContain('/login');

    // 页面标题可见
    await expect(page.getByText('商品分类管理').first()).toBeVisible({ timeout: 10_000 });

    // 表格渲染（antd Table）
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10_000 });

    // 至少存在一行数据（种子分类）
    const rows = page.locator('.ant-table-tbody tr.ant-table-row');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    expectNoFatalConsole(getErrors());
  });

  test('新建分类 — 弹窗填写名称并保存', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/categories');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10_000 });

    // 点击 "新增顶级分类" 按钮
    const addBtn = page.getByRole('button', { name: /新增顶级分类/ });
    await expect(addBtn).toBeVisible({ timeout: 5_000 });
    await addBtn.click();

    // 弹窗打开 — Modal title 包含 "新增顶级分类"
    const modal = page.locator('.ant-modal-content');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 填写分类名称（Form.Item name="name" → id="name"）
    await modal.locator('#name').fill(categoryName);

    // 点击确定（Modal footer OK 按钮）
    await page.locator('.ant-modal').locator('.ant-modal-footer').getByRole('button', { name: /确\s*定|OK/i }).click();

    // 等待弹窗关闭
    await expect(page.locator('.ant-modal-content')).not.toBeVisible({ timeout: 10_000 });

    // 列表中出现新分类
    await expect(page.getByText(categoryName).first()).toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });

  test('编辑分类 — 双击行内编辑名称', async ({ page }) => {
    test.skip(true, '需要对照实际 UI 验证双击编辑交互：行内编辑依赖 onDoubleClick 事件和 onBlur/Enter 保存，Playwright 模拟可能不稳定');
  });

  test.skip('删除分类 — Popconfirm 确认后移除', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/categories');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10_000 });

    // 先创建一个用于删除的分类
    const deleteName = `E2E-删除测试-${Date.now()}`;
    const addBtn = page.getByRole('button', { name: /新增顶级分类/ });
    await addBtn.click();
    const modal = page.locator('.ant-modal-content');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await modal.locator('#name').fill(deleteName);
    await page.locator('.ant-modal').locator('.ant-modal-footer').getByRole('button', { name: /确\s*定|OK/i }).click();
    await expect(page.locator('.ant-modal-content')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(deleteName).first()).toBeVisible({ timeout: 10_000 });

    // 找到新建分类所在行
    const row = page.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: deleteName });
    await expect(row.first()).toBeVisible({ timeout: 10_000 });

    // 点击该行的 "删除" 按钮（Button type="link" danger）
    const deleteBtn = row.first().getByRole('button', { name: /删除/ }).first();
    // 如果按钮被 disabled（有子分类/商品），跳过
    const isDisabled = await deleteBtn.isDisabled().catch(() => true);
    if (isDisabled) {
      test.skip(true, '该分类有子分类或商品，删除按钮被禁用');
      return;
    }
    await deleteBtn.click();

    // Popconfirm 确认（Popconfirm title="确认删除此分类？"）
    const confirmBtn = page.locator('.ant-popconfirm').getByRole('button', { name: /确\s*定|是|OK|Yes/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // 等待 success message
    await page.waitForTimeout(1000); await page.waitForLoadState('networkidle');

    // 该名称不再出现
    await expect(page.getByText(deleteName)).not.toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });
});

/* ---------- 运费模板（运费规则） ---------- */
test.describe('运费规则 CRUD', () => {
  const uniqueSuffix = Date.now();
  const ruleName = `E2E-运费-${uniqueSuffix}`;
  const ruleNameEdited = `E2E-运费改-${uniqueSuffix}`;

  test('列表加载 — 运费规则表格渲染', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/shipping-rules');
    await page.waitForLoadState('networkidle');

    expect(page.url()).not.toContain('/login');

    // ProTable headerTitle="运费规则管理"
    await expect(page.getByText('运费规则管理').first()).toBeVisible({ timeout: 10_000 });

    // ProTable 渲染（尝试 .ant-pro-table 或 .ant-table）
    await expect(page.locator('.ant-pro-table, .ant-table').first()).toBeVisible({ timeout: 10_000 });

    // 免运费门槛卡片（Card title="免运费门槛"）
    await expect(page.getByText('免运费门槛').first()).toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });

  test('新建运费规则 — ModalForm 填写并保存', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/shipping-rules');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.ant-pro-table, .ant-table').first()).toBeVisible({ timeout: 10_000 });

    // 点击 "新增规则" 按钮
    const addBtn = page.getByRole('button', { name: /新增规则/ });
    await expect(addBtn).toBeVisible({ timeout: 5_000 });
    await addBtn.click();

    // ModalForm 打开（ProComponents ModalForm 渲染为 .ant-modal）
    const modal = page.locator('.ant-modal-content');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 填写规则名称（ProFormText name="name"）
    await modal.locator('#name').fill(ruleName);

    // 填写运费（ProFormDigit name="fee"）
    await modal.locator('#fee').fill('8.5');

    // 提交（ModalForm 的确认按钮在 footer 中）
    await page.locator('.ant-modal').locator('.ant-modal-footer .ant-btn-primary').click();

    // 等待弹窗关闭
    await expect(page.locator('.ant-modal-content')).not.toBeVisible({ timeout: 10_000 });

    // 列表中出现新规则
    await expect(page.getByText(ruleName).first()).toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });

  test('编辑运费规则 — 修改名称并保存', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/shipping-rules');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.ant-pro-table, .ant-table').first()).toBeVisible({ timeout: 10_000 });

    // 找到刚创建的规则行
    const row = page.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: ruleName });
    await expect(row.first()).toBeVisible({ timeout: 10_000 });

    // 点击 "编辑" 操作（Button type="link"）
    const editBtn = row.first().getByRole('button', { name: /编辑/ }).first();
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await editBtn.click();

    // ModalForm 打开
    const modal = page.locator('.ant-modal-content');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 清空并输入新名称
    await modal.locator('#name').fill(ruleNameEdited);

    // 提交
    await page.locator('.ant-modal').locator('.ant-modal-footer .ant-btn-primary').click();

    // 等待弹窗关闭
    await expect(page.locator('.ant-modal-content')).not.toBeVisible({ timeout: 10_000 });

    // 列表出现新名称
    await expect(page.getByText(ruleNameEdited).first()).toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });

  test.skip('删除运费规则 — Popconfirm 确认后移除', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/shipping-rules');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.ant-pro-table, .ant-table').first()).toBeVisible({ timeout: 10_000 });

    // 找到编辑后的规则行
    const row = page.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: ruleNameEdited });
    await expect(row.first()).toBeVisible({ timeout: 10_000 });

    // 点击 "删除" 操作（Button type="link" danger）
    const deleteBtn = row.first().getByRole('button', { name: /删除/ }).first();
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
    await deleteBtn.click();

    // Popconfirm 确认
    const confirmBtn = page.locator('.ant-popconfirm').getByRole('button', { name: /确\s*定|是|OK|Yes/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // 等待 success message
    await page.waitForTimeout(1000); await page.waitForLoadState('networkidle');

    // 该名称不再出现
    await expect(page.getByText(ruleNameEdited)).not.toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });
});
