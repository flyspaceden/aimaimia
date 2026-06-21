import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const read = (path: string) => readFileSync(join(root, path), 'utf8');
const sourceFiles = (dir: string): string[] => {
  const absolute = join(root, dir);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return sourceFiles(relative);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
};

test('delivery center exposes the task 17 operational routes', () => {
  const app = read('src/App.tsx');
  const layout = read('src/layouts/SellerLayout.tsx');

  for (const route of [
    'products/stock',
    'orders/logistics',
    'exports',
    'customer-service',
    'company/settings',
    'company/staff',
    'account-security',
  ]) {
    assert.match(app, new RegExp(route.replace('/', '\\/')));
  }

  for (const menuText of ['库存管理', '物流跟踪', '经营导出', '客服中心']) {
    assert.match(layout, new RegExp(menuText));
  }
});

test('delivery center layout shows the full operational menu in the sidebar', () => {
  const layout = read('src/layouts/SellerLayout.tsx');

  for (const group of ['商品管理', '订单履约', '经营导出', '企业与人员', '客服中心']) {
    assert.match(layout, new RegExp(group), `layout should expose grouped menu ${group}`);
  }

  for (const [group, path] of [
    ['商品管理', '/delivery-products'],
    ['订单履约', '/delivery-orders'],
    ['企业与人员', '/delivery-company'],
  ]) {
    assert.match(
      layout,
      new RegExp(`path:\\s*['"]${path.replace('/', '\\/')}['"][\\s\\S]*?name:\\s*['"]${group}['"][\\s\\S]*?routes:\\s*\\[`),
      `grouped sidebar menu ${group} should have its own path so ProLayout renders it`,
    );
  }

  const routePathMatches = [...layout.matchAll(/path:\s*['"]([^'"]+)['"]/g)];
  const routePaths = routePathMatches.map((match) => match[1]);
  assert.equal(new Set(routePaths).size, routePaths.length, 'sidebar menu paths must be unique to avoid Ant Menu key collisions');

  assert.match(layout, /layout="side"/);
  assert.doesNotMatch(layout, /layout="mix"/);
  assert.match(layout, /#EA580C/);
  assert.match(layout, /切换爱买买卖家中心/);
});

test('delivery center operational pages use seller-center dense page components', () => {
  for (const file of [
    'src/pages/dashboard/index.tsx',
    'src/pages/exports/index.tsx',
    'src/pages/orders/logistics.tsx',
    'src/pages/company/index.tsx',
    'src/pages/company/staff.tsx',
    'src/pages/customer-service/index.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /ProCard|ProTable/, `${file} should use ProCard or ProTable`);
  }
});

test('delivery center routes and menus use seller permission codes instead of role-only gates', () => {
  const app = read('src/App.tsx');
  const layout = read('src/layouts/SellerLayout.tsx');
  const profileType = read('src/types/index.ts');
  const authStore = read('src/store/useAuthStore.ts');

  assert.match(profileType, /permissionCodes:\s*string\[\]/);
  assert.match(authStore, /hasPermission/);
  assert.match(app, /RequirePermission/);
  assert.match(layout, /permission:\s*['"]staff:manage['"]/);
  assert.doesNotMatch(app, /RequireRole/);
  assert.doesNotMatch(layout, /roles:\s*\[/);
});

test('delivery center keeps a logged-in switch back to the main seller center', () => {
  const layout = read('src/layouts/SellerLayout.tsx');
  assert.match(layout, /切换爱买买卖家中心/);
  assert.match(layout, /seller\.ai-maimai\.com/);
  assert.match(layout, /test-seller\.ai-maimai\.com/);
});

test('delivery center login page explains the test phone credentials', () => {
  const source = read('src/pages/login/index.tsx');

  for (const label of [
    '登录账号是手机号',
    '不要填写内部账号名',
    '测试时建议使用密码登录',
    '默认密码：123456',
    '短信登录请先点击获取验证码',
    '测试服务器以实际短信验证码为准',
    '本地模拟环境可用 123456',
    '请以收到的短信或本地后端控制台为准',
    '13800001001',
    '配送中心 OWNER',
    '配送示范供应商',
  ]) {
    assert.ok(source.includes(label), `login page should explain ${label}`);
  }

  assert.doesNotMatch(source, /delivery_seed_owner/);
  assert.doesNotMatch(source, /短信验证码：123456/);
  assert.doesNotMatch(source, /13800001002/);
});

test('delivery center uses delivery-seller API namespaces for task 17 modules', () => {
  const expectedFiles = [
    'src/api/inventory.ts',
    'src/api/shipments.ts',
    'src/api/manifests.ts',
    'src/api/settlements.ts',
    'src/api/customerService.ts',
  ];

  for (const file of expectedFiles) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
    const source = read(file);
    assert.doesNotMatch(source, /client\.(get|post|patch|put|delete)\(['"`](?!\/delivery-seller\/)/);
  }
});

test('all active delivery center API calls stay in the delivery-seller namespace', () => {
  const apiDir = join(root, 'src/api');
  const apiFiles = readdirSync(apiDir)
    .filter((file) => file.endsWith('.ts') && file !== 'client.ts')
    .map((file) => `src/api/${file}`);

  for (const file of apiFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /client\.(get|post|patch|put|delete)\(['"`](?!\/delivery-seller\/)/,
      file,
    );
  }
});

test('delivery center does not keep routed refund or analytics surfaces', () => {
  for (const removedPath of [
    'src/api/after-sale.ts',
    'src/api/analytics.ts',
    'src/api/trace.ts',
    'src/pages/after-sale/index.tsx',
    'src/pages/after-sale/detail.tsx',
    'src/pages/analytics/index.tsx',
    'src/pages/trace/index.tsx',
  ]) {
    assert.equal(existsSync(join(root, removedPath)), false, `${removedPath} should not exist`);
  }

  const app = read('src/App.tsx');
  const layout = read('src/layouts/SellerLayout.tsx');
  assert.doesNotMatch(app, /after-sale|analytics|trace/);
  assert.doesNotMatch(layout, /售后管理|退款|数据看板|溯源管理|analytics|trace/);
});

test('active delivery seller source avoids platform price identifiers', () => {
  const activeFiles = sourceFiles('src');
  const forbiddenBusinessDomains = /\b(after[-_]?sale|refund|vip|coupon|bonus|reward|lottery|digital[-_]?assets|analytics|trace)\b|售后|退款|退货|换货|VIP|红包|奖励|抽奖|数字资产|数据看板|溯源/i;
  const forbiddenPriceIdentifiers = /\b(basePriceCents|fixedFinalPriceCents|finalPriceCents|finalUnitPrice|finalLineAmount|buyerFinalAmountCents|platformMargin|grossMargin|profitCents|revenueCents|markup|markupBps|defaultMarkupBps|pricingSource)\b/;
  for (const file of activeFiles) {
    if (!existsSync(join(root, file))) continue;
    const source = read(file);
    assert.doesNotMatch(source, forbiddenBusinessDomains, file);
    assert.doesNotMatch(source, forbiddenPriceIdentifiers, file);
  }
});

test('delivery center opens manifests and waybills through backend download requests', () => {
  for (const file of ['src/pages/exports/index.tsx', 'src/pages/orders/detail.tsx']) {
    const source = read(file);
    assert.match(source, /downloadDeliveryUploadWithAuth/, `${file} should use authenticated private download requests`);
    assert.doesNotMatch(source, /toAbsoluteApiUrl/, `${file} should not open OSS files directly`);
  }
});

test('delivery center downloads private files with authenticated API requests before opening blobs', () => {
  const helper = read('src/utils/uploadDownload.ts');
  assert.match(helper, /client\.get\([\s\S]*responseType:\s*['"]blob['"]/, 'download helper must use authenticated axios blob requests');
  assert.match(helper, /URL\.createObjectURL/, 'download helper must open a local blob URL instead of a raw storage URL');

  for (const file of ['src/pages/exports/index.tsx', 'src/pages/orders/detail.tsx', 'src/pages/products/edit.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /window\.open\(request\.href/, `${file} must not open protected download URLs without auth headers`);
    assert.doesNotMatch(source, /triggerBrowserDownload\(request\.href/, `${file} must not trigger naked browser downloads`);
  }

  const productEdit = read('src/pages/products/edit.tsx');
  assert.doesNotMatch(productEdit, /window\.open\(previewFile\.url/, 'product image download must not fall back to opening the raw storage URL');
});

test('delivery center local dev proxy defaults to the staging API', () => {
  const viteConfig = read('vite.config.ts');
  assert.match(viteConfig, /VITE_PROXY_TARGET/);
  assert.match(viteConfig, /https:\/\/test-api\.ai-maimai\.com/);
  assert.doesNotMatch(viteConfig, /target:\s*['"]http:\/\/localhost:3000['"]/);
});

test('delivery center visible labels translate backend enum values and technical field names', () => {
  const visibleSourceFiles = [
    'src/pages/company/index.tsx',
    'src/pages/company/staff.tsx',
    'src/pages/customer-service/index.tsx',
    'src/pages/exports/index.tsx',
    'src/pages/orders/detail.tsx',
    'src/pages/orders/index.tsx',
    'src/pages/orders/logistics.tsx',
    'src/pages/products/edit.tsx',
    'src/pages/products/index.tsx',
    'src/pages/products/stock.tsx',
  ];

  for (const file of visibleSourceFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /title:\s*['"](?:SKU\s|.*\sID)['"]/, `${file} must not expose technical English column titles`);
    assert.doesNotMatch(source, /label:\s*['"](?:OPEN|CLOSED|ACTIVE|DISABLED|OWNER|MANAGER|OPERATOR|PENDING|APPROVED|REJECTED)['"]/, `${file} must not expose raw enum labels`);
    assert.doesNotMatch(source, /\{(?:status|value|role|order\.status|row\.shipment\.status|staff\.role)\s*\|\|\s*['"]-['"]\}/, `${file} must not render raw enum fallbacks`);
    assert.doesNotMatch(source, /\|\|\s*(?:order|row|staff|company)\.(?:status|role)/, `${file} must not fall back to raw enum values`);
  }
});

test('delivery center company and staff settings use guided Chinese setting workflows', () => {
  const company = read('src/pages/company/index.tsx');
  const staff = read('src/pages/company/staff.tsx');

  for (const label of ['基础资料', '联系方式', '当前状态', '操作权限']) {
    assert.match(company, new RegExp(label), `company settings should expose ${label}`);
  }

  for (const label of ['权限分组', '新增员工', '分配权限', '禁用员工', '商品与库存', '订单与履约']) {
    assert.match(staff, new RegExp(label), `staff settings should expose ${label}`);
  }

  assert.match(staff, /permissionGroups/);
  assert.match(staff, /Checkbox\.Group/);
  assert.match(staff, /Drawer/);
  assert.match(staff, /Switch/);
  assert.doesNotMatch(staff, /mode=["']tags["']/);
});
