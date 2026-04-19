import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectNoFatalConsole } from '../helpers/console';

/**
 * 管理后台 P2 页面 CRUD 测试
 *
 * 覆盖：抽奖管理、标签管理、VIP 礼包、客服 FAQ/快捷回复、角色权限
 *
 * 依赖：
 *   - storageState 已由 admin project 注入（超管），不需要手动登录
 *   - 种子数据中存在相应数据
 */

// ============================================================
// 抽奖管理 /lottery
// ============================================================
test.describe('抽奖管理页面', () => {
  test('列表加载 → 奖池管理 Tab 可见且有数据', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/lottery');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    // Tabs 渲染：奖池管理 Tab 默认选中
    await expect(page.locator('.ant-tabs-tab').filter({ hasText: '奖池管理' }).first()).toBeVisible({ timeout: 10_000 });

    // ProTable 至少有一行种子奖品
    const tableRows = page.locator('.ant-table-row');
    await expect(tableRows.first()).toBeVisible({ timeout: 15_000 });

    // 种子数据中应存在奖品名称（低价购/满额赠/谢谢参与 等类型标签）
    const tableBody = page.locator('.ant-table-tbody');
    const bodyText = await tableBody.textContent();
    const hasPrize =
      bodyText?.includes('低��购') ||
      bodyText?.includes('��额赠') ||
      bodyText?.includes('谢谢参与');
    expect(hasPrize, '奖池表格中应包含种子奖品类型标签').toBeTruthy();

    expectNoFatalConsole(getErrors());
  });

  test('抽奖记录 Tab 可切换且渲染表格', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/lottery');
    await page.waitForLoadState('networkidle');

    // 切换到抽奖记录 Tab
    const recordsTab = page.locator('.ant-tabs-tab').filter({ hasText: '抽奖记录' }).first();
    await expect(recordsTab).toBeVisible({ timeout: 10_000 });
    await recordsTab.click();
    await page.waitForLoadState('networkidle');

    // 抽奖记录 Tab 内容应渲染（标题"抽奖记录"可见即证明 Tab 已切换成功）
    await page.waitForTimeout(2000);
    await expect(page.getByText('抽奖记录').nth(1)).toBeVisible({ timeout: 5_000 });

    expectNoFatalConsole(getErrors());
  });

  test('数据统计 Tab 可切换且渲染统计卡片', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/lottery');
    await page.waitForLoadState('networkidle');

    // 切换到数据统计 Tab
    const statsTab = page.locator('.ant-tabs-tab').filter({ hasText: '数据统计' }).first();
    await expect(statsTab).toBeVisible({ timeout: 10_000 });
    await statsTab.click();
    await page.waitForLoadState('networkidle');

    // 统计卡片应渲染（今日抽奖次数 / 今日中奖次数 / 活跃奖品数）
    await expect(page.getByText('今日抽奖次数')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('活跃奖品数')).toBeVisible();

    expectNoFatalConsole(getErrors());
  });
});

// ============================================================
// 标签管理 /tags
// ============================================================
test.describe('标签管理页面', () => {
  test('列表加载 → 标签类别可见', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/tags');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    // 左侧"标签类别"卡片可见（Card title="��签类别"）
    await expect(page.getByText('标签类别').first()).toBeVisible({ timeout: 10_000 });

    // 右侧提示"请选择一个类别"或已选中某类别显示"标签列表"
    const hasHint = await page.getByText('请选择一个类别').isVisible().catch(() => false);
    const hasTagList = await page.getByText('标签列表').isVisible().catch(() => false);
    expect(hasHint || hasTagList, '右侧应显示选择提示或标签列表').toBeTruthy();

    expectNoFatalConsole(getErrors());
  });

  test('新建标签类别 → 保存 → 可见', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/tags');
    await page.waitForLoadState('networkidle');

    // 点击左侧"新增类别"按钮
    const addCategoryBtn = page.getByRole('button', { name: /新增类别/ });
    await expect(addCategoryBtn).toBeVisible({ timeout: 10_000 });
    await addCategoryBtn.click();

    // Modal 应出现
    const modal = page.locator('.ant-modal-content');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 填写类别名称
    const categoryName = `E2E-标签类别-${Date.now()}`;
    await modal.locator('#name').fill(categoryName);

    // 选择适用范围（通过 form-item 文本定位 Select）
    const scopeFormItem = modal.locator('.ant-form-item').filter({ hasText: '适用范围' });
    await scopeFormItem.locator('.ant-select-selector').click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item').filter({ hasText: '企业' }).first().click();

    // 点击确定
    await page.locator('.ant-modal-footer .ant-btn-primary').click();

    // 等待 modal 关闭 + 网络请求完成
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await expect(modal).not.toBeVisible({ timeout: 10_000 });

    // 新类别应在左侧列表中可见
    await expect(page.getByText(categoryName)).toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });
});

// ============================================================
// VIP 礼包 /vip-gifts
// ============================================================
test.describe('VIP 礼包页面', () => {
  test('列表加载 → 赠品方案列表可见', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/vip-gifts');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    // 页面标题可见（用 .first() 避免 strict mode violation）
    await expect(page.getByText('赠品方案列表').first()).toBeVisible({ timeout: 10_000 });

    // 赠品方案列表 ProTable 渲染
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10_000 });

    // VIP 档位管理 Card 可��
    await expect(page.getByText('VIP 档位管理').first()).toBeVisible();

    expectNoFatalConsole(getErrors());
  });

  test('VIP 配置规则 Alert 可见 + 表格渲染', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/vip-gifts');
    await page.waitForLoadState('networkidle');

    // 配��规则 Alert 可见
    await expect(page.getByText('VIP 赠品配置规则').first()).toBeVisible({ timeout: 10_000 });

    // 表格结构在（可能无数据行，但表格结构存在）
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10_000 });

    // "新增赠品方案"按钮可见
    const addBtn = page.getByRole('button', { name: /新增赠品方案/ });
    await expect(addBtn).toBeVisible();

    expectNoFatalConsole(getErrors());
  });
});

// ============================================================
// 客服 FAQ /cs/faq
// ============================================================
test.describe('客服 FAQ 页面', () => {
  test('列表��载 → FAQ 表格可见', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/cs/faq');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    // 页面标题"FAQ管理"可见
    await expect(page.getByText('FAQ管理').first()).toBeVisible({ timeout: 10_000 });

    // 表格渲染
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10_000 });

    // 测试匹配区域可见
    await expect(page.getByText('测试匹配').first()).toBeVisible();

    expectNoFatalConsole(getErrors());
  });

  test.skip('新建 FAQ → 保存', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/cs/faq');
    await page.waitForLoadState('networkidle');

    // 点击"新增FAQ"按钮
    const addBtn = page.getByRole('button', { name: /新增FAQ/ });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Modal 应出现
    const modal = page.locator('.ant-modal-content');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 填写关键词（tag input：fill → Enter → 等 tag 出现）
    const keywordInput = modal.locator('input[placeholder*="关键词"]').first();
    const keywordText = `E2E测试关键词${Date.now()}`;
    await keywordInput.fill(keywordText);
    await keywordInput.press('Enter');
    await page.waitForTimeout(500);

    // 填写回复内容
    await modal.locator('#answer').fill('这是 E2E 自动测试创建的 FAQ 回复内容');

    // 点击确定
    await page.locator('.ant-modal-footer .ant-btn-primary').click();

    // 等待 modal 关闭 + 网络请求完成
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await expect(modal).not.toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });
});

// ============================================================
// 客服快捷回复 /cs/quick-replies
// ============================================================
test.describe('客服快捷回复页面', () => {
  test('列表加载 → 快捷回复表格可见', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/cs/quick-replies');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    // 页面标题可见
    await expect(page.getByText('客服快捷回复').first()).toBeVisible({ timeout: 10_000 });

    // 表格渲染
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });

  test('新建快捷回复 → 保存', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/cs/quick-replies');
    await page.waitForLoadState('networkidle');

    // 点击"新增快捷回复"
    const addBtn = page.getByRole('button', { name: /新增快捷回复/ });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Modal 应出现
    const modal = page.locator('.ant-modal-content');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 选择分类（通过 form-item 文本定位 Select）
    const categoryFormItem = modal.locator('.ant-form-item').filter({ hasText: '分类' });
    await categoryFormItem.locator('.ant-select-selector').click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item').filter({ hasText: '通用' }).first().click();

    // 填写标题
    await modal.locator('#title').fill(`E2E-快捷回复-${Date.now()}`);

    // 填写回复内容
    await modal.locator('#content').fill('这是 E2E 自动测试创建的快捷回复');

    // 点击确定
    await page.locator('.ant-modal-footer .ant-btn-primary').click();

    // 等待 modal 关闭 + 网络请求完成
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await expect(modal).not.toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });
});

// ============================================================
// 角色权限管理 /admin/roles
// ============================================================
test.describe('角色权限管理页面', () => {
  test('列表加载 → 系统角色可见', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/admin/roles');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('/login');

    // 页面标题"角色权限管理"可见（Card title）
    await expect(page.getByText('角色权限管理').first()).toBeVisible({ timeout: 10_000 });

    // 表格渲染
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10_000 });
    const tableRows = page.locator('.ant-table-row');
    await expect(tableRows.first()).toBeVisible({ timeout: 15_000 });

    // 应存在"系统角色" Tag（isSystem=true 的角色渲染为 <Tag color="red">系统角色</Tag>）
    await expect(page.locator('.ant-tag').filter({ hasText: '系统角色' }).first()).toBeVisible();

    expectNoFatalConsole(getErrors());
  });

  test.skip('新建角色 → 勾选权限 → 保存 → 删除', async ({ page }) => {
    const getErrors = collectConsoleErrors(page);

    await page.goto('/admin/roles');
    await page.waitForLoadState('networkidle');

    // 点击"新增角色"
    const addBtn = page.getByRole('button', { name: /新增角色/ });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Modal 应出现
    const modal = page.locator('.ant-modal-content');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 填写角色名称
    const roleName = `E2E-角色-${Date.now()}`;
    await modal.locator('#name').fill(roleName);

    // 填写描述
    await modal.locator('#description').fill('E2E 自动测试创建的角色');

    // 勾选至少第一个权限复选框
    const checkboxes = modal.locator('.ant-checkbox-wrapper');
    const checkboxCount = await checkboxes.count();
    const toCheck = Math.min(3, checkboxCount);
    for (let i = 0; i < toCheck; i++) {
      await checkboxes.nth(i).click();
    }

    // 点击确定
    await page.locator('.ant-modal-footer .ant-btn-primary').click();

    // 等待 modal 关闭 + 网络请求完成
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await expect(modal).not.toBeVisible({ timeout: 10_000 });

    // 新角色应在表格中可见
    await expect(page.getByText(roleName)).toBeVisible({ timeout: 10_000 });

    // 删除刚创建的角色
    const roleRow = page.locator('.ant-table-row').filter({ hasText: roleName });
    const deleteBtn = roleRow.getByRole('button', { name: /删除/ }).first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Popconfirm 确认（兼容 ant-popconfirm 和 ant-popover）
    const confirmBtn = page.locator('.ant-popconfirm .ant-btn-primary, .ant-popover .ant-btn-primary').first();
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 });
    await confirmBtn.click();

    // 等待删除完成
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');

    // 角色应从表格中消失
    await expect(page.getByText(roleName)).not.toBeVisible({ timeout: 10_000 });

    expectNoFatalConsole(getErrors());
  });
});
