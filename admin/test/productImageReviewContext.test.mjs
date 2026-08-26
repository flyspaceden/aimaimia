import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/pages/products/media-revisions.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/api/productMediaRevisions.ts', import.meta.url), 'utf8');

test('admin image review shows a bounded fact-scan summary for generated candidates', () => {
  assert.match(page, /生成与事实凭证/);
  assert.match(page, /免费实景调优/);
  assert.match(page, /最小事实摘要，不展示 OCR 原文/);
  assert.match(page, /扫描结论不确定/);
  assert.match(api, /reviewContext:/);
  assert.match(api, /freeTuneEligible: boolean/);
});

test('admin browser contract does not expose OCR plaintext or hashes', () => {
  assert.doesNotMatch(page, /ocrTextHash/);
  assert.doesNotMatch(api, /ocrTextHash/);
  assert.doesNotMatch(page, /providerOutputUrl/);
});
