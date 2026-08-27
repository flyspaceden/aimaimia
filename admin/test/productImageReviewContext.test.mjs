import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/pages/products/media-revisions.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api/productMediaRevisions.ts', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/layouts/AdminLayout.tsx', import.meta.url), 'utf8');

test('admin image inspection compares history and current published media without exposing OCR details', () => {
  assert.match(page, /商品图片巡检与回滚/);
  assert.match(page, /商家变更前的历史图片/);
  assert.match(page, /商家采用后发布的图片/);
  assert.match(page, /恢复到变更前图片并通知商家/);
  assert.match(api, /reviewContext:/);
  assert.match(api, /freeTuneEligible: boolean/);
  assert.match(api, /previousMedia:/);
  assert.match(layout, /图片巡检与回滚/);
  assert.doesNotMatch(layout, /封面变更审核/);
  assert.match(page, /图片变更记录加载失败/);
  assert.match(page, /product\.mediaVersion === detail\.data\.revision\.appliedMediaVersion/);
});

test('admin browser contract does not expose OCR plaintext or hashes', () => {
  assert.doesNotMatch(page, /ocrTextHash/);
  assert.doesNotMatch(api, /ocrTextHash/);
  assert.doesNotMatch(page, /providerOutputUrl/);
});
