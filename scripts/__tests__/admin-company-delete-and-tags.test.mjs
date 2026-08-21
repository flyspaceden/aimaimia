import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('企业列表提供有权限的软删除、名称确认和回收站恢复', async () => {
  const source = await read('admin/src/pages/companies/index.tsx');
  assert.match(source, /PERMISSIONS\.COMPANIES_DELETE/);
  assert.match(source, /getCompanyDeletionCheck/);
  assert.match(source, /deleteConfirmation !== deleteTarget\?\.name/);
  assert.match(source, /key: 'recycle'/);
  assert.match(source, /restoreCompany/);
});

test('企业标签无选项时给出明确的标签管理入口', async () => {
  const source = await read('admin/src/pages/companies/detail.tsx');
  assert.match(source, /暂无可用企业标签/);
  assert.match(source, /navigate\('\/tags'\)/);
  assert.match(source, /preservedTagIds/);
  assert.match(source, /该企业已删除，当前为只读状态/);
  assert.match(source, /submitter=\{isDeleted \? false : undefined\}/);
});

test('生产迁移幂等补齐企业标签和独立删除权限', async () => {
  const migration = await read('backend/prisma/migrations/20260821020000_add_company_soft_delete_and_production_tags/migration.sql');
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'DELETED'/);
  assert.match(migration, /ON CONFLICT \("code"\) DO NOTHING/);
  assert.match(migration, /'company_cert'/);
  assert.match(migration, /'service_area'/);
  assert.match(migration, /'product_tag'/);
  assert.match(migration, /'PRODUCT', 'TRACE', 'AI'/);
  assert.match(migration, /'companies:delete'/);
  assert.match(migration, /role\."name" = '超级管理员'/);
});

test('删除企业不能通过旧商品或旧购物车绕过', async () => {
  const productService = await read('backend/src/modules/product/product.service.ts');
  const checkoutService = await read('backend/src/modules/order/checkout.service.ts');
  const cartService = await read('backend/src/modules/cart/cart.service.ts');
  const followService = await read('backend/src/modules/follow/follow.service.ts');
  const bookingService = await read('backend/src/modules/booking/booking.service.ts');
  const groupService = await read('backend/src/modules/group/group.service.ts');
  const companyService = await read('backend/src/modules/company/company.service.ts');
  const recommendationService = await read('backend/src/modules/recommendation/recommendation.service.ts');
  const traceService = await read('backend/src/modules/trace/trace.service.ts');
  const aiService = await read('backend/src/modules/ai/ai.service.ts');
  assert.match(productService, /company: \{ status: 'ACTIVE', isPlatform: false \}/);
  assert.match(productService, /product\.company\?\.status !== 'ACTIVE'/);
  assert.match(checkoutService, /companyStatus !== 'ACTIVE'/);
  assert.match(checkoutService, /activeCompanyCount !== checkoutCompanyIds\.length/);
  assert.match(cartService, /COMPANY_INACTIVE/);
  assert.match(followService, /status: 'ACTIVE'/);
  assert.match(followService, /isPlatform: false/);
  assert.match(bookingService, /status: 'ACTIVE'/);
  assert.match(bookingService, /isPlatform: false/);
  assert.match(groupService, /company: \{ status: 'ACTIVE', isPlatform: false \}/);
  assert.match(companyService, /where: \{ id, status: 'ACTIVE', isPlatform: false \}/);
  assert.match(recommendationService, /company: \{ status: 'ACTIVE', isPlatform: false \}/);
  assert.match(traceService, /company: \{ status: 'ACTIVE', isPlatform: false \}/);
  assert.match(aiService, /company: \{ status: 'ACTIVE', isPlatform: false \}/);
});
