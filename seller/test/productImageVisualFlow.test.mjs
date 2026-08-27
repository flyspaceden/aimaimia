import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editPage = readFileSync(new URL('../src/pages/products/edit.tsx', import.meta.url), 'utf8');
const visualApi = readFileSync(new URL('../src/api/productImageVisualPlans.ts', import.meta.url), 'utf8');
const optimizationApi = readFileSync(new URL('../src/api/productImageOptimizations.ts', import.meta.url), 'utf8');

test('seller image flow creates a local plan before it exposes a free real-scene candidate', () => {
  assert.match(editPage, /查看美化建议/);
  assert.match(editPage, /requestProductVisualPlan\(productId, \{ sourceAssetId:/);
  assert.match(editPage, /检查图片中的商品事实/);
  assert.match(editPage, /const freeTuneAvailable = visualPlan\?\.riskProfile === 'STANDARD_FACTS'/);
  assert.match(editPage, /factScan\.freeTuneEligible === true/);
  assert.match(editPage, /disabled=\{!freeTuneAvailable \|\| optimizationSubmitting\}/);
  assert.match(editPage, /requestFreeTune\(\{/);
});

test('seller API uses product-bound planning, fact scanning, and explicit FREE_TUNE intents', () => {
  assert.match(visualApi, /\/seller\/products\/\$\{productId\}\/visual-enhancements\/plan/);
  assert.match(visualApi, /\/seller\/media-assets\/\$\{sourceAssetId\}\/fact-scan/);
  assert.match(optimizationApi, /intent: 'FREE_TUNE'/);
  assert.match(optimizationApi, /planId: string/);
});

test('seller UI keeps original evidence and never promises an automatic publish', () => {
  assert.match(editPage, /原图始终保留，候选不会自动发布/);
  assert.match(editPage, /候选尚未发布。采用后会保留原实拍证据图/);
  assert.match(editPage, /商品数量、配件和比例完整/);
  assert.match(editPage, /包装、型号、文字和二维码未变化/);
  assert.match(editPage, /颜色、规格、材质和实物一致/);
});

test('seller paid image flow shows a server quote and requires an explicit credit confirmation', () => {
  assert.match(editPage, /付费 AI 强效果/);
  assert.match(editPage, /先报价，后生成/);
  assert.match(editPage, /查看可用方案与额度/);
  assert.match(editPage, /本次 \{visualQuote\.quote\.creditCost\} 图片额度/);
  assert.match(editPage, /我确认使用 \{visualQuote\.quote\.creditCost\} 图片额度生成/);
  assert.match(editPage, /disabled=\{!quoteConfirmed\}/);
  assert.match(editPage, /confirmProductVisualQuote\(/);
  assert.match(editPage, /pollProductVisualQuote\(/);
  assert.match(editPage, /候选已生成，等待管理员事实复核/);
  assert.match(editPage, /候选未通过系统事实检查/);
  assert.match(editPage, /系统未达到自动通过条件/);
});

test('seller paid visual API remains product-bound and cannot send a free-form provider prompt', () => {
  assert.match(visualApi, /\/seller\/products\/\$\{productId\}\/visual-rate-cards/);
  assert.match(visualApi, /\/seller\/products\/\$\{productId\}\/visual-quotes/);
  assert.match(visualApi, /quoteHash/);
  assert.doesNotMatch(visualApi, /prompt:/);
  assert.doesNotMatch(visualApi, /providerUrl/);
});
