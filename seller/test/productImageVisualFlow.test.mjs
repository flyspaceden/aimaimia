import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editPage = readFileSync(new URL('../src/pages/products/edit.tsx', import.meta.url), 'utf8');
const visualApi = readFileSync(new URL('../src/api/productImageVisualPlans.ts', import.meta.url), 'utf8');
const optimizationApi = readFileSync(new URL('../src/api/productImageOptimizations.ts', import.meta.url), 'utf8');

test('seller image flow creates a local plan before it exposes a free real-scene candidate', () => {
  assert.match(editPage, /查看美化建议/);
  assert.match(editPage, /正在上传并完成安全扫描和素材登记/);
  assert.match(editPage, /重新上传/);
  assert.match(editPage, /image\/jpeg,image\/png,image\/webp/);
  assert.match(editPage, /onProgress\?\.\(\{ percent \}\)/);
  assert.match(editPage, /requestProductVisualPlan\(productId, \{ sourceAssetId:/);
  assert.match(editPage, /hasTransparentPixels \? '免费合成白底图' : '智能白底 \/ 棚拍'/);
  assert.match(editPage, /startVisualPlan\(file, 'CATALOG_STUDIO'\)/);
  assert.match(editPage, /检查图片中的商品事实/);
  assert.match(editPage, /const freeTuneAvailable = freeTuneEligibility\(visualPlan, factScan\)/);
  assert.match(editPage, /visualPlan\.processingPlan\?\.freeTunePolicy/);
  assert.match(editPage, /disabled=\{!freeTuneAvailable \|\| optimizationSubmitting\}/);
  assert.match(editPage, /requestFreeTune\(\{/);
});

test('seller API uses product-bound planning, fact scanning, and explicit FREE_TUNE intents', () => {
  assert.match(visualApi, /\/seller\/products\/\$\{productId\}\/visual-enhancements\/plan/);
  assert.match(visualApi, /\/seller\/media-assets\/\$\{sourceAssetId\}\/fact-scan/);
  assert.doesNotMatch(visualApi, /visual-test-access/);
  assert.doesNotMatch(editPage, /ensureProductVisualTestAccess/);
  assert.match(optimizationApi, /intent: 'FREE_TUNE'/);
  assert.match(optimizationApi, /planId: string/);
});

test('seller UI keeps original evidence and makes the immediate-publication rule explicit', () => {
  assert.match(editPage, /原图始终保留，候选不会自动发布/);
  assert.match(editPage, /候选尚未发布。采用后会保留原实拍证据图；已上架商品会立即更新公开图片/);
  assert.match(editPage, /公开商品图已更新；系统已保留历史版本/);
  assert.match(editPage, /商品数量、配件和比例完整/);
  assert.match(editPage, /包装、型号、文字和二维码未变化/);
  assert.match(editPage, /颜色、规格、材质和实物一致/);
});

test('seller paid image flow shows a server quote and requires an explicit credit confirmation', () => {
  assert.match(editPage, /付费智能精修/);
  assert.match(editPage, /先报价，后生成/);
  assert.match(editPage, /查看可用方案与图片积分/);
  assert.match(editPage, /本次 \{visualQuote\.quote\.creditCost\} 图片积分/);
  assert.match(editPage, /我确认使用 \{visualQuote\.quote\.creditCost\} 图片积分生成/);
  assert.match(editPage, /商品资料或图片版本已变化，系统已自动刷新并生成新报价/);
  assert.match(editPage, /visualPlanNeedsRefresh\(error\)/);
  assert.match(editPage, /商品标题、分类或图片版本已变化/);
  assert.match(editPage, /listProductVisualRateCards\(productId, refreshedRequest\)/);
  assert.match(editPage, /createQuote\(refreshedPlan, refreshedDirection, refreshedCard\.code\)/);
  assert.match(editPage, /营销场景图仅供展示/);
  assert.match(editPage, /不能替换商品事实主图/);
  assert.match(editPage, /candidateRole === 'MARKETING_IMAGE'/);
  assert.match(editPage, /当前不能采用或替换商品公开图片/);
  assert.match(editPage, /disabled=\{!quoteConfirmed \|\| Boolean\(paidExecution\)\}/);
  assert.match(editPage, /disabled=\{quoteExpired \|\| Boolean\(paidExecution\) \|\| quoteSubmitting\}/);
  assert.match(editPage, /confirmProductVisualQuote\(/);
  assert.match(editPage, /pollProductVisualQuote\(/);
  assert.match(editPage, /候选可采用；系统已保留验真摘要/);
  assert.match(editPage, /候选未通过系统事实检查/);
  assert.match(editPage, /新候选不会等待平台预审批/);
  assert.match(editPage, /paidExecution\?\.status === 'SUCCEEDED' && paidExecution\.optimizationId/);
  assert.match(editPage, /setOptimizationTask\(await getProductImageOptimization\(paidExecution\.optimizationId\)\)/);
  assert.match(editPage, /await reopenActivePaidCandidate\(\{ asset, url, name: file\.name \|\| '商品图片' \}\)/);
  assert.match(editPage, /paidExecution\?\.optimizationId === optimizationTask\.id/);
  assert.match(editPage, /const adoptingPaidDirection = adoptingCurrentPaidTask \? visualQuote\?\.quote\.visualPlanSnapshot\?\.direction : undefined/);
  assert.match(editPage, /currentPaidOptimization \? visualQuote\?\.quote\.visualPlanSnapshot\?\.direction : undefined/);
  assert.match(editPage, /const endPaidPreview = currentPaidOptimization && !candidateCanBeAdopted/);
  assert.match(editPage, /paidDirection === 'PRESERVE_REAL_SCENE'\) return '实景精修候选'/);
  assert.match(editPage, /setPaidExecution\(null\)/);
});

test('seller paid visual API remains product-bound and cannot send a free-form provider prompt', () => {
  assert.match(visualApi, /client\.post\(`\/seller\/products\/\$\{productId\}\/visual-rate-cards\/resolve`, params\)/);
  assert.match(visualApi, /\/seller\/products\/\$\{productId\}\/visual-quotes/);
  assert.match(visualApi, /quoteHash/);
  assert.doesNotMatch(visualApi, /prompt:/);
  assert.doesNotMatch(visualApi, /providerUrl/);
});

test('ordinary product save never resubmits unchanged public media and redirects changed media to the explicit publish action', () => {
  assert.match(editPage, /sameMediaAssetOrder\(product\.media \?\? \[\], payload\.mediaAssetIds\)/);
  assert.match(editPage, /setRevisionModalOpen\(true\)/);
  assert.match(editPage, /const productPayload = activePublicProduct \? omitMediaAssetIds\(payload\) : payload/);
  assert.match(editPage, /商品图片已变化。请先在“商品图片”卡片中确认“更新公开图片”/);
});

test('confirmed paid tasks survive page navigation without a second freeze or Provider submission', () => {
  assert.match(editPage, /ai-visual-agent:active-quote:/);
  assert.match(editPage, /paidPollInFlightRef/);
  assert.match(editPage, /getProductVisualQuote\(productId, id\)/);
  assert.match(editPage, /正在查询已有任务，不会重复扣除图片积分/);
  assert.match(editPage, /ALREADY_BOUND/);
  assert.match(editPage, /重新选择方案/);
});

test('seller image enhancement copy is Chinese-first', () => {
  assert.match(editPage, /智能图片美化/);
  assert.match(editPage, /智能图片美化建议/);
  assert.match(editPage, /智能图片美化报价/);
  assert.doesNotMatch(editPage, /AI 图片美化|付费 AI 强效果|AI 图片任务状态/);
});

test('seller fact scan hides disabled provider internals and prevents repeated clicks', () => {
  assert.match(editPage, /function productFactScanFailure/);
  assert.match(editPage, /商品文字识别服务暂未开启，当前不能进行免费实景调优/);
  assert.match(editPage, /免费实景调优暂不可用/);
  assert.match(editPage, /disabled=\{Boolean\(factScanUnavailableReason\)\}/);
  assert.match(editPage, /setFactScanUnavailableReason\(feedback\.message\)/);
  assert.match(editPage, /PRODUCT_FACT_SCAN_OCR_DISABLED/);
  assert.doesNotMatch(editPage, /error\.status === 503/);
});

test('seller paid section shows image-credit balance and an honest acquisition entry before quoting', () => {
  assert.match(editPage, /可用 \{visualCreditAccount\?\.availableCredits \?\? 0\}/);
  assert.match(editPage, /冻结 \{visualCreditAccount\?\.reservedCredits \?\? 0\}/);
  assert.match(editPage, /获取图片积分/);
  assert.match(editPage, /在线购买暂未开放/);
  assert.match(editPage, /生成后预计剩余/);
  assert.match(editPage, /当前可用 \{visualQuote\.availableCredits\} 图片积分/);
  assert.match(editPage, /生成后预计 \{Math\.max\(0, visualQuote\.availableCredits - visualQuote\.quote\.creditCost\)\}/);
  assert.match(editPage, /visualCreditRequestRef/);
});

test('seller visual requests cannot write an old image quote into a newer image flow', () => {
  assert.match(editPage, /visualFlowGenerationRef/);
  assert.match(editPage, /visualFlowGenerationRef\.current !== flowGeneration/);
  assert.match(editPage, /result\.quote\.sourceAssetRef !== sourceSnapshot\.asset\.asset\.id/);
  assert.match(editPage, /setOptimizationSource\(visualQuote\.source\)/);
  assert.match(editPage, /closable=\{!visualPlanSubmitting && !factScanSubmitting && !optimizationSubmitting && !rateCardsLoading && !quoteSubmitting\}/);
  assert.match(editPage, /disabled=\{Boolean\(paidExecution\) \|\| rateCardsLoading \|\| quoteSubmitting\}/);
});
