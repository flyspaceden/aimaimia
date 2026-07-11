import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../src/', import.meta.url);

test('live preview hook schedules API previews and invalidates stale work', async () => {
  const source = await readFile(new URL('hooks/useConfigProfitSafetyPreview.ts', root), 'utf8');
  assert.match(source, /createProfitSafetyPreviewScheduler/);
  assert.match(source, /scheduler\.invalidate\(\)/);
  assert.match(source, /previewProfitSafety\(\{ updates \}\)/);
  assert.match(source, /return \(\) => \{\s*scheduler\.invalidate\(\)/);
  assert.match(source, /Object\.hasOwn\(normalizedValues, key\)/);
  assert.match(source, /import type \{ ProfitSafetySummary, RuleConfig \} from '@\/types';/);
  assert.match(source, /import \{ previewProfitSafety \} from '@\/api\/config';/);
  assert.match(source, /export type ProfitSafetyPreviewState/);
  assert.match(source, /export interface UseConfigProfitSafetyPreviewInput/);
  assert.match(source, /schema: readonly ProfitSafetyPreviewConfigMeta\[\]/);
  assert.match(source, /\}: UseConfigProfitSafetyPreviewInput\): ProfitSafetyPreviewState/);
  assert.match(source, /const fingerprint = JSON\.stringify\(updates\)/);
  assert.match(source, /asyncState\?\.fingerprint !== fingerprint/);
  const effectSource = source.slice(source.indexOf('useEffect('));
  assert.doesNotMatch(effectSource, /setState/);
});

test('status presentation covers every candidate state and component keeps captain conflict action', async () => {
  const source = await readFile(new URL('components/ProfitSafetyStatus.tsx', root), 'utf8');
  const presentationSource = await readFile(new URL('utils/configProfitSafetyPreview.ts', root), 'utf8');
  for (const text of [
    '正在校验未保存参数',
    '请先使七项比例合计为 100% 再校验利润安全',
    '请先修正存在校验错误的参数再校验利润安全',
    '未保存参数的利润安全校验失败',
    '未保存参数通过利润安全校验',
    '未保存参数未通过利润安全校验',
  ]) {
    assert.match(presentationSource, new RegExp(text));
  }
  assert.match(source, /getProfitSafetyStatusPresentation/);
  assert.match(source, /previewState/);
  assert.match(source, /ProfitSafetyPreviewState/);
  assert.match(source, /处理团长冲突/);
});
