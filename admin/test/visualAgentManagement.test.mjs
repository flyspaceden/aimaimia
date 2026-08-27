import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('AI Visual Agent management is restricted and exposes rate, credit, and candidate review paths', () => {
  const api = read('src/api/visualAgent.ts');
  const page = read('src/pages/visual-agent/index.tsx');
  const app = read('src/App.tsx');
  const layout = read('src/layouts/AdminLayout.tsx');

  assert.match(api, /\/admin\/visual-agent\/tenants/);
  assert.match(api, /\/admin\/product-paid-visual-candidates/);
  assert.match(page, /新商家欢迎额度/);
  assert.match(page, /费率卡（面向商家的固定报价）/);
  assert.match(page, /付费候选事实复核/);
  assert.match(page, /候选不会自动发布/);
  assert.match(app, /PERMISSIONS\.ADMIN_VISUAL_AGENT_MANAGE/);
  assert.match(layout, /path: '\/visual-agent', name: 'AI Visual Agent'/);
  assert.match(page, /PERMISSIONS\.PRODUCTS_AUDIT/);
});

test('admin visual management never contains a provider key, free prompt, or direct model switch', () => {
  const api = read('src/api/visualAgent.ts');
  const page = read('src/pages/visual-agent/index.tsx');

  assert.doesNotMatch(api, /apiKey|providerKey|secret/i);
  assert.doesNotMatch(page, /name="(?:apiKey|providerKey|secret)"/i);
  assert.doesNotMatch(page, /name="(?:prompt|providerEnabled)"/i);
});
