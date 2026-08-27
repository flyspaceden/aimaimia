import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('AI Visual Agent management is restricted and exposes rate, credit, and legacy-candidate paths', () => {
  const api = read('src/api/visualAgent.ts');
  const page = read('src/pages/visual-agent/index.tsx');
  const app = read('src/App.tsx');
  const layout = read('src/layouts/AdminLayout.tsx');

  assert.match(api, /\/admin\/visual-agent\/tenants/);
  assert.match(api, /\/admin\/product-paid-visual-candidates/);
  assert.match(page, /新商家欢迎额度/);
  assert.match(page, /费率卡（面向商家的固定报价）/);
  assert.match(page, /历史付费候选处理/);
  assert.match(page, /系统会将不确定结果提升为事后巡检优先/);
  assert.match(page, /新候选不做发布前预审批/);
  assert.match(page, /AI Visual Agent 配置加载失败/);
  assert.match(page, /欢迎额度策略保存失败/);
  assert.match(page, /当前每次报价固定交付 1 张已验真候选/);
  assert.match(page, /max=\{1\}/);
  assert.match(page, /wan2\.7-image-pro/);
  assert.match(api, /\/admin\/visual-agent\/budget-policies/);
  assert.match(api, /\/admin\/visual-agent\/reconciliations/);
  assert.match(page, /Provider 六层预算策略/);
  assert.match(page, /模型调用人工对账/);
  assert.match(page, /六层 reserveCents 必须一致/);
  assert.match(page, /按证据关闭对账/);
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
