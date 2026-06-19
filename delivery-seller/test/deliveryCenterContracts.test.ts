import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const read = (path: string) => readFileSync(join(root, path), 'utf8');

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

test('active delivery seller source avoids platform price identifiers', () => {
  const activeFiles = [
    'src/App.tsx',
    'src/layouts/SellerLayout.tsx',
    'src/api/dashboard.ts',
    'src/api/products.ts',
    'src/api/orders.ts',
    'src/api/company.ts',
    'src/api/inventory.ts',
    'src/api/shipments.ts',
    'src/api/manifests.ts',
    'src/api/settlements.ts',
    'src/api/customerService.ts',
    'src/pages/dashboard/index.tsx',
    'src/pages/products/index.tsx',
    'src/pages/products/edit.tsx',
    'src/pages/products/stock.tsx',
    'src/pages/orders/index.tsx',
    'src/pages/orders/detail.tsx',
    'src/pages/orders/logistics.tsx',
    'src/pages/exports/index.tsx',
    'src/pages/company/index.tsx',
    'src/pages/company/staff.tsx',
    'src/pages/customer-service/index.tsx',
    'src/pages/account-security/index.tsx',
    'src/types/index.ts',
  ];

  const forbidden = /\b(basePriceCents|fixedFinalPriceCents|finalPriceCents|markup|totalAmountCents|buyerFinalAmountCents)\b/;
  for (const file of activeFiles) {
    if (!existsSync(join(root, file))) continue;
    assert.doesNotMatch(read(file), forbidden, file);
  }
});
