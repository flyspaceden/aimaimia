import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const read = (path: string) => readFileSync(join(root, path), 'utf8');

const collectFiles = (dir: string): string[] => {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute).flatMap((entry) => {
    const fullPath = join(absolute, entry);
    const relPath = relative(root, fullPath);
    return statSync(fullPath).isDirectory() ? collectFiles(relPath) : [relPath];
  });
};

test('delivery admin active routes expose only delivery management modules', () => {
  const app = read('src/App.tsx');
  const layout = read('src/layouts/AdminLayout.tsx');

  for (const route of [
    'stats',
    'users',
    'units',
    'merchants',
    'merchant-applications',
    'products',
    'pricing-rules',
    'orders',
    'shipping-records',
    'abnormal-payments',
    'manifests',
    'settlements',
    'cs/workstation',
    'cs/tickets',
    'cs/faq',
    'cs/quick-entries',
    'cs/quick-replies',
    'cs/dashboard',
    'audit',
    'config',
  ]) {
    assert.match(app, new RegExp(route.replace('/', '\\/')));
  }

  for (const forbidden of [
    'after-sale',
    'bonus',
    'vip',
    'coupons',
    'lottery',
    'digital-assets',
    'refund',
    '售后',
    '退款',
    'VIP',
    '红包',
    '抽奖',
    '数字资产',
  ]) {
    assert.doesNotMatch(app, new RegExp(forbidden, 'i'), `App exposes ${forbidden}`);
    assert.doesNotMatch(layout, new RegExp(forbidden, 'i'), `Layout exposes ${forbidden}`);
  }
});

test('delivery admin layout uses admin-style grouped operational navigation', () => {
  const layout = read('src/layouts/AdminLayout.tsx');

  for (const group of ['用户与单位', '商家与商品', '订单与履约', '客服中心', '系统管理']) {
    assert.match(layout, new RegExp(group), `layout should expose grouped menu ${group}`);
  }

  for (const groupPath of ['/delivery-users', '/delivery-commerce', '/delivery-fulfillment', '/delivery-service', '/delivery-system']) {
    assert.match(layout, new RegExp(groupPath.replace('/', '\\/')), `grouped menus need parent path ${groupPath}`);
  }

  for (const route of [
    '/users',
    '/units',
    '/merchants',
    '/merchant-applications',
    '/products',
    '/pricing-rules',
    '/orders',
    '/shipping-records',
    '/abnormal-payments',
    '/manifests',
    '/settlements',
    '/cs/workstation',
    '/cs/tickets',
    '/cs/faq',
    '/cs/quick-entries',
    '/cs/quick-replies',
    '/cs/dashboard',
    '/audit',
    '/config',
    '/account-security',
  ]) {
    assert.match(layout, new RegExp(route.replace('/', '\\/')), `layout should expose ${route}`);
  }
});

test('delivery admin navigation is filtered by delivery admin permissions', () => {
  const layout = read('src/layouts/AdminLayout.tsx');
  const authStore = read('src/store/useAuthStore.ts');

  assert.match(layout, /permissionAny/, 'grouped menu should support any-of permissions');
  assert.match(layout, /permission:\s*['"]delivery:/, 'menu entries should declare delivery permissions');
  assert.match(layout, /filteredRoute/, 'layout should pass filtered routes to ProLayout');
  assert.match(layout, /hasPermission/, 'layout should use the admin permission checker');
  assert.match(layout, /route=\{filteredRoute\}/, 'ProLayout should render permission-filtered menu routes');
  assert.match(authStore, /delivery:\*/, 'frontend permission checker should support delivery wildcard permission');
  assert.match(authStore, /\$\{moduleName\}:\*/, 'frontend permission checker should support module wildcard permission');
});

test('delivery admin core list pages use mature ProTable request patterns', () => {
  for (const file of [
    'src/pages/delivery-admin/users.tsx',
    'src/pages/delivery-admin/units.tsx',
    'src/pages/delivery-admin/merchants.tsx',
    'src/pages/delivery-admin/merchant-applications.tsx',
    'src/pages/delivery-admin/products.tsx',
    'src/pages/delivery-admin/orders.tsx',
    'src/pages/delivery-admin/shipping-records.tsx',
    'src/pages/delivery-admin/settlements.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /ProTable/, `${file} should use ProTable`);
    assert.match(source, /request=\{async/, `${file} should load data through ProTable request`);
    assert.match(source, /toolBarRender/, `${file} should expose admin-style toolbar actions`);
  }
});

test('delivery admin active API clients stay in the delivery-admin namespace', () => {
  for (const file of ['src/api/auth.ts', 'src/api/delivery-management.ts']) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /client\.(get|post|patch|put|delete)\(['"`](?!\/delivery-admin\/)/,
      file,
    );
    assert.doesNotMatch(source, /\/admin\//, `${file} should not call main admin namespace`);
    assert.doesNotMatch(source, /\/delivery-seller\//, `${file} should not call seller namespace`);
  }
});

test('delivery admin source tree does not keep inactive main-admin modules', () => {
  assert.deepEqual(
    readdirSync(join(root, 'src/pages')).sort(),
    ['account-security', 'delivery-admin', 'login'],
  );

  assert.deepEqual(
    readdirSync(join(root, 'src/api')).sort(),
    ['auth.ts', 'client.ts', 'delivery-management.ts'],
  );

  for (const removedPath of ['src/components', 'src/constants']) {
    assert.equal(existsSync(join(root, removedPath)), false, `${removedPath} should not exist in delivery admin`);
  }

  const forbidden = [
    'after-sale',
    'bonus',
    'coupon',
    'coupons',
    'vip',
    'lottery',
    'digital-assets',
    'reward-products',
    'refund',
    '售后',
    '退款',
    'VIP',
    '红包',
    '抽奖',
    '数字资产',
  ];

  for (const file of collectFiles('src')) {
    if (!/\.(ts|tsx)$/.test(file)) {
      continue;
    }
    const source = read(file);
    for (const token of forbidden) {
      assert.doesNotMatch(source, new RegExp(token, 'i'), `${file} contains legacy token ${token}`);
    }
  }
});

test('delivery admin keeps a logged-in switch back to the main ai-maimai admin', () => {
  const layout = read('src/layouts/AdminLayout.tsx');
  assert.match(layout, /切换爱买买管理后台/);
  assert.match(layout, /admin\.ai-maimai\.com/);
  assert.match(layout, /test-admin\.ai-maimai\.com/);
});

test('delivery admin local dev proxy defaults to the staging API', () => {
  const viteConfig = read('vite.config.ts');
  assert.match(viteConfig, /VITE_PROXY_TARGET/);
  assert.match(viteConfig, /https:\/\/test-api\.ai-maimai\.com/);
  assert.doesNotMatch(viteConfig, /target:\s*['"]http:\/\/localhost:3000['"]/);
});

test('delivery admin visible labels translate backend enum values and technical field names', () => {
  const visibleSourceFiles = [
    'src/pages/delivery-admin/components.tsx',
    'src/pages/delivery-admin/config.tsx',
    'src/pages/delivery-admin/manifests.tsx',
    'src/pages/delivery-admin/merchant-applications.tsx',
    'src/pages/delivery-admin/merchant-application-detail.tsx',
    'src/pages/delivery-admin/merchants.tsx',
    'src/pages/delivery-admin/orders.tsx',
    'src/pages/delivery-admin/pricing-rules.tsx',
    'src/pages/delivery-admin/products.tsx',
    'src/pages/delivery-admin/settlements.tsx',
    'src/pages/delivery-admin/units.tsx',
  ];

  for (const file of visibleSourceFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /text:\s*item\b/, `${file} must not expose raw enum text in filters`);
    assert.doesNotMatch(source, /label:\s*['"](?:APPROVED|REJECTED|PENDING|ACTIVE|INACTIVE|SUSPENDED|PLATFORM|MERCHANT|PRODUCT|SKU)['"]/, `${file} must not expose raw enum labels`);
    assert.doesNotMatch(source, /title:\s*['"](?:key|scope|fieldKey|App|Admin|Excel|PDF|SKU\s|.*\sID)['"]/, `${file} must not expose technical English column titles`);
    assert.doesNotMatch(source, /字段标识|字段编号|模板编号/, `${file} must not expose internal field identifiers`);
    assert.doesNotMatch(source, /label \/ sortOrder \/ visible/, `${file} must not describe template columns with technical English names`);
  }
});

test('delivery admin config page uses categorized setting panels and operator-facing rule editing', () => {
  const source = read('src/pages/delivery-admin/config.tsx');

  for (const label of ['配送单位字段', '清单与导出', '平台规则', '显示位置', '影响范围', '低库存展示', '逐单自定义列']) {
    assert.match(source, new RegExp(label), `config page should expose ${label}`);
  }

  assert.match(source, /configCategoryItems/);
  assert.match(source, /Drawer/);
  assert.match(source, /Switch/);
  assert.match(source, /InputNumber/);
  assert.match(source, /lowStockThreshold/);
  assert.match(source, /manifestCustomColumnsEnabled/);
  assert.match(source, /renderPlatformRules/);
  assert.match(source, /保存平台规则/);
  assert.match(source, /onValuesChange=\{\(\) => setRuleDirty\(true\)\}/);
  assert.doesNotMatch(source, /系统参数/);
  assert.doesNotMatch(source, /客服与通知/);
  assert.doesNotMatch(source, /高级参数/);
  assert.doesNotMatch(source, /新增系统参数/);
  assert.doesNotMatch(source, /配置标识/);
  assert.doesNotMatch(source, /配置范围/);
  assert.doesNotMatch(source, /配置内容（JSON）/);
  assert.doesNotMatch(source, /JSON/);
  assert.doesNotMatch(source, /配置内容预览/);
  assert.doesNotMatch(source, /valueText/);
  assert.doesNotMatch(source, /departmentName/);
  assert.doesNotMatch(source, /<Typography\.Text type="secondary">\{record\.fieldKey\}<\/Typography\.Text>/);
  assert.doesNotMatch(source, /字段编号/);
  assert.doesNotMatch(source, /字段标识/);
  assert.doesNotMatch(source, /模板编号/);
  assert.doesNotMatch(source, /openRuleDrawer/);
  assert.doesNotMatch(source, /ruleOpen/);
  assert.doesNotMatch(source, /editingRuleKey/);
  assert.doesNotMatch(source, /编辑平台规则/);
  assert.doesNotMatch(source, /编辑低库存展示/);
  assert.doesNotMatch(source, /编辑逐单自定义列/);
  assert.doesNotMatch(source, /<Tabs/);
  assert.doesNotMatch(source, /<Modal/);
  assert.doesNotMatch(source, /label=["'](?:key|fieldKey|placeholder|options)/);
});

test('delivery admin pricing rules page uses operator-facing pricing language', () => {
  const source = read('src/pages/delivery-admin/pricing-rules.tsx');

  for (const label of [
    '价格规则说明',
    '一条规则只回答三件事',
    '先定管谁',
    '再定数量',
    '最后定价格',
    '命中顺序',
    '规格优先',
    '商品其次',
    '商家再次',
    '全平台兜底',
    '常用设置',
    '全平台默认加价',
    '商家单独加价',
    '大批量阶梯价',
    '规则适用对象',
    '数量门槛',
    '定价方式',
    '价格预览',
    '适用场景',
    '按供货价加价',
    '直接指定售价',
    '供货价 × (1 + 加价比例)',
    '买家看到的售价',
    '编辑步骤',
    '从第几件开始生效',
    '到第几件结束',
    '规则优先级',
  ]) {
    assert.ok(source.includes(label), `pricing rules page should expose ${label}`);
  }

  assert.match(source, /pricingRuleGuideItems/);
  assert.match(source, /pricingQuickActionItems/);
  assert.match(source, /renderPricingSummary/);
  assert.match(source, /renderTargetSummary/);
  assert.match(source, /renderPricingPreview/);
  assert.match(source, /renderPricingGuide/);
  assert.match(source, /renderRuleMatchPath/);
  assert.match(source, /renderRuleScenario/);
  assert.match(source, /FormSection/);
  const tableIndex = source.indexOf('<ProTable<DeliveryPriceRule>');
  const guideIndex = source.indexOf('{renderPricingGuide()}');
  const explanationIndex = source.indexOf('message="价格规则说明"');
  assert.notEqual(tableIndex, -1, 'pricing rules table should exist');
  assert.notEqual(guideIndex, -1, 'pricing guide should exist');
  assert.notEqual(explanationIndex, -1, 'pricing explanation should exist');
  assert.ok(tableIndex < guideIndex, 'existing pricing rules must appear before guide content');
  assert.ok(tableIndex < explanationIndex, 'existing pricing rules must appear before pricing explanation');
  assert.doesNotMatch(source, /title:\s*['"]作用域['"]/);
  assert.doesNotMatch(source, /title:\s*['"]规则类型['"]/);
  assert.doesNotMatch(source, /label=["']作用域/);
  assert.doesNotMatch(source, /label=["']规则类型/);
  assert.doesNotMatch(source, /placeholder=["']作用域/);
  assert.doesNotMatch(source, /placeholder=["']规则类型/);
  assert.doesNotMatch(source, /固定价（分）/);
  assert.doesNotMatch(source, /加价率（万分比）/);
  assert.doesNotMatch(source, /商家:\s*\{/);
  assert.doesNotMatch(source, /商品:\s*\{/);
  assert.doesNotMatch(source, /规格:\s*\{/);
});

test('delivery admin customer-service center mirrors the main admin six-page structure', () => {
  const app = read('src/App.tsx');
  const layout = read('src/layouts/AdminLayout.tsx');

  for (const route of [
    'cs/workstation',
    'cs/tickets',
    'cs/faq',
    'cs/quick-entries',
    'cs/quick-replies',
    'cs/dashboard',
  ]) {
    assert.match(app, new RegExp(route.replace('/', '\\/')), `App should expose ${route}`);
  }

  for (const label of ['对话工作台', '工单管理', 'FAQ 管理', '快捷入口配置', '坐席快捷回复', '数据看板']) {
    assert.match(layout, new RegExp(label), `layout should expose customer service page ${label}`);
  }

  for (const file of [
    'src/pages/delivery-admin/cs-workstation.tsx',
    'src/pages/delivery-admin/cs-tickets.tsx',
    'src/pages/delivery-admin/cs-faq.tsx',
    'src/pages/delivery-admin/cs-quick-entries.tsx',
    'src/pages/delivery-admin/cs-quick-replies.tsx',
    'src/pages/delivery-admin/cs-dashboard.tsx',
  ]) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
    const source = read(file);
    assert.doesNotMatch(source, /接口接入前|后续补齐|待接入|占位/, `${file} should not expose unfinished customer-service wording`);
  }
});
