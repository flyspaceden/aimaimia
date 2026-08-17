import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('seller editor distinguishes persisted price from the price after save', async () => {
  const source = await read('seller/src/pages/products/edit.tsx');

  assert.match(source, /当前实际售价/);
  assert.match(source, /保存后售价/);
  assert.match(source, /保存后将按成本 × \{markupRate\} 更新真实成交价/);
  assert.match(source, /currentPrice=\{product\?\.skus\?\.\[0\]\?\.price\}/);

  const buildPayload = source.slice(
    source.indexOf('function buildPayload('),
    source.indexOf('// ============================================================\n// 入口：'),
  );
  assert.doesNotMatch(buildPayload, /basePrice/);
});

test('platform settings previews and confirms a markup reprice before batch save', async () => {
  const [page, api] = await Promise.all([
    read('admin/src/pages/config/index.tsx'),
    read('admin/src/api/config.ts'),
  ]);

  assert.match(api, /markup-reprice-preview/);
  assert.match(page, /confirmMarkupReprice/);
  assert.match(page, /这会修改当前普通商品的真实成交价/);
  assert.match(page, /batchUpdateConfig\(\{/);
  assert.match(page, /markupPreviewToken: markupPreview\.previewToken/);
});

test('generic admin product editor only allows manual price for platform rewards', async () => {
  const page = await read('admin/src/pages/products/edit.tsx');

  assert.match(page, /const isPlatformProduct = product\.company\?\.isPlatform === true/);
  assert.match(page, /isPlatformProduct \? \(/);
  assert.match(page, /calculateSellingPrice/);
  assert.match(page, /当前实际/);
  assert.match(page, /价格核对/);
  assert.match(page, /确认同步修改真实售价/);
});

test('seed and fallback pricing defaults stay at 1.30 and seller seed writes use the formula', async () => {
  const [seed, productionBootstrap, bonusConfig, profitSafety, repriceScript] = await Promise.all([
    read('backend/prisma/seed.ts'),
    read('backend/prisma/production-bootstrap.ts'),
    read('backend/src/modules/bonus/engine/bonus-config.service.ts'),
    read('backend/src/modules/profit/profit-safety.service.ts'),
    read('backend/scripts/reprice-products.ts'),
  ]);

  assert.match(seed, /const SEED_MARKUP_RATE = 1\.3/);
  assert.match(seed, /sellerSeedPrice\(p\.skuCost\)/);
  assert.match(seed, /price: sellerSeedPrice\(sku\.cost\)/);
  assert.match(productionBootstrap, /key: 'MARKUP_RATE', value: 1\.30/);
  assert.match(bonusConfig, /markupRate: 1\.30/);
  assert.match(profitSafety, /MARKUP_RATE: 1\.3/);
  assert.match(repriceScript, /--execute/);
  assert.match(repriceScript, /--expected-markup=/);
  assert.match(repriceScript, /--preview-token=/);
  assert.match(repriceScript, /new ProfitSafetyService/);
});
