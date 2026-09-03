import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('商品图片智能美化管理受权限保护并提供费率、额度和历史候选链路', () => {
  const api = read('src/api/visualAgent.ts');
  const page = read('src/pages/visual-agent/index.tsx');
  const app = read('src/App.tsx');
  const layout = read('src/layouts/AdminLayout.tsx');

  assert.match(api, /\/admin\/visual-agent\/tenants/);
  assert.match(api, /\/admin\/product-paid-visual-candidates/);
  assert.match(page, /新商家欢迎图片积分/);
  assert.match(page, /费率卡（面向商家的固定报价）/);
  assert.match(page, /开通指定测试商家/);
  assert.match(page, /只授权指定商家、人员和商品/);
  assert.match(page, /所有测试商家已默认开放/);
  assert.match(api, /\/admin\/visual-agent\/test-authorizations\/status/);
  assert.match(page, /营销展示图/);
  assert.match(api, /\/admin\/visual-agent\/test-authorizations/);
  assert.match(page, /历史付费候选处理/);
  assert.match(page, /系统会将不确定结果提升为事后巡检优先/);
  assert.match(page, /新候选不做发布前预审批/);
  assert.match(page, /商品图片智能美化配置加载失败/);
  assert.match(page, /欢迎图片积分策略保存失败/);
  assert.match(page, /当前每次报价固定交付 1 张已验真候选/);
  assert.match(page, /max=\{1\}/);
  assert.match(page, /wan2\.7-image-pro/);
  assert.match(api, /\/admin\/visual-agent\/budget-policies/);
  assert.match(api, /\/admin\/visual-agent\/reconciliations/);
  assert.match(page, /模型服务六层预算策略/);
  assert.match(page, /模型调用人工对账/);
  assert.match(page, /六层的每次预占成本必须一致/);
  assert.match(page, /按证据关闭对账/);
  assert.match(app, /PERMISSIONS\.ADMIN_VISUAL_AGENT_MANAGE/);
  assert.match(layout, /path: '\/visual-agent', name: '商品图片智能美化'/);
  assert.match(page, /平台租户编号/);
  assert.match(page, /接入客户端编号/);
  assert.match(page, /适配器命名空间/);
  assert.match(page, /暂停（默认）/);
  assert.match(page, /商品主图（FACT_MAIN_IMAGE）/);
  assert.doesNotMatch(page, /AI Visual Agent|label="(?:Tenant|Client|Adapter|Provider)/);
  assert.match(page, /PERMISSIONS\.PRODUCTS_AUDIT/);
});

test('admin visual management never contains a provider key, free prompt, or direct model switch', () => {
  const api = read('src/api/visualAgent.ts');
  const page = read('src/pages/visual-agent/index.tsx');

  assert.doesNotMatch(api, /apiKey|providerKey|secret/i);
  assert.doesNotMatch(page, /name="(?:apiKey|providerKey|secret)"/i);
  assert.doesNotMatch(page, /name="(?:prompt|providerEnabled)"/i);
});
