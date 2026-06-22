import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBundleCatalogQuery } from '../src/pages/products/bundleCatalog.ts';

test('bundle catalog query uses bounded active product search', () => {
  assert.deepEqual(buildBundleCatalogQuery(), {
    page: 1,
    pageSize: 50,
    status: 'ACTIVE',
  });
});

test('bundle catalog query includes trimmed keyword only when present', () => {
  assert.deepEqual(buildBundleCatalogQuery('  苹果 礼盒  '), {
    page: 1,
    pageSize: 50,
    status: 'ACTIVE',
    keyword: '苹果 礼盒',
  });

  assert.deepEqual(buildBundleCatalogQuery('   '), {
    page: 1,
    pageSize: 50,
    status: 'ACTIVE',
  });
});

test('bundle catalog query can request product type before pagination', () => {
  assert.deepEqual(buildBundleCatalogQuery('苹果', 'SIMPLE'), {
    page: 1,
    pageSize: 50,
    status: 'ACTIVE',
    productType: 'SIMPLE',
    keyword: '苹果',
  });

  assert.deepEqual(buildBundleCatalogQuery('', 'BUNDLE'), {
    page: 1,
    pageSize: 50,
    status: 'ACTIVE',
    productType: 'BUNDLE',
  });
});
