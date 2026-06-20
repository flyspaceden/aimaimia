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

  for (const menuText of ['库存管理', '物流跟踪', '导出中心', '客服工单']) {
    assert.match(layout, new RegExp(menuText));
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
