import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../src/', import.meta.url);
const backendModulesRoot = new URL('../../backend/src/modules/', import.meta.url);

function extractBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `missing start token: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(end, -1, `missing end token: ${endToken}`);
  return source.slice(start, end);
}

function extractBalancedBlock(source, startToken, open, close) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `missing start token: ${startToken}`);
  const openIndex = source.indexOf(open, start + startToken.length - 1);
  assert.notEqual(openIndex, -1, `missing opening ${open}: ${startToken}`);

  let depth = 0;
  let quote;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated balanced block: ${startToken}`);
}

function extractJsxOpeningTag(source, component) {
  const startToken = `<${component}`;
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `missing JSX tag: ${component}`);
  const end = source.indexOf('/>', start + startToken.length);
  assert.notEqual(end, -1, `unterminated JSX tag: ${component}`);
  return source.slice(start, end + 2);
}

function assertConfigPagePreviewIntegration(source) {
  const permissionRegion = extractBetween(
    source,
    'const { hasPermission } = usePermission();',
    'const [drawerOpen, setDrawerOpen]',
  );
  assert.match(permissionRegion, /const canUpdateConfig = hasPermission\(PERMISSIONS\.CONFIG_UPDATE\);/);

  const validationRegion = extractBetween(
    source,
    'const hasValidationErrors = useMemo(',
    'const profitSafetyPreview = useConfigProfitSafetyPreview(',
  );
  assert.match(validationRegion, /form\.getFieldsError\(\)/);
  assert.match(validationRegion, /\[allValues, form\]/);

  const previewCall = extractBalancedBlock(
    source,
    'useConfigProfitSafetyPreview(',
    '(',
    ')',
  );
  for (const input of [
    'configs,',
    'values: allValues,',
    'schema: CONFIG_SCHEMA,',
    'sumValid,',
    'hasValidationErrors,',
    'enabled: configs.length > 0 && dirty && canUpdateConfig,',
  ]) {
    assert.ok(previewCall.includes(input), `preview call missing input: ${input}`);
  }

  const statusTag = extractJsxOpeningTag(source, 'ProfitSafetyStatus');
  assert.match(statusTag, /previewState=\{profitSafetyPreview\}/);

  const saveCallback = extractBalancedBlock(source, 'const doSave = useCallback', '{', '}');
  assert.match(saveCallback, /message\.success\('配置保存成功'\);/);
  assert.match(saveCallback, /setDirty\(false\);/);
  assert.match(saveCallback, /setChangeNote\(''\);/);
}

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
  const hookInput = extractBalancedBlock(
    source,
    'export function useConfigProfitSafetyPreview(',
    '(',
    ')',
  );
  assert.match(hookInput, /delayMs = 500/);
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

test('VIP configuration previews dirty candidate profit safety without changing save reset behavior', async () => {
  const source = await readFile(new URL('pages/bonus/vip-config.tsx', root), 'utf8');

  assert.match(source, /import \{ useConfigProfitSafetyPreview \} from '@\/hooks\/useConfigProfitSafetyPreview';/);
  assert.match(source, /import \{ usePermission \} from '@\/hooks\/usePermission';/);
  assertConfigPagePreviewIntegration(source);
});

test('normal configuration previews dirty candidate profit safety without changing save reset behavior', async () => {
  const source = await readFile(new URL('pages/bonus/normal-config.tsx', root), 'utf8');

  assert.match(source, /import \{ useConfigProfitSafetyPreview \} from '@\/hooks\/useConfigProfitSafetyPreview';/);
  assert.match(source, /import \{ usePermission \} from '@\/hooks\/usePermission';/);
  assertConfigPagePreviewIntegration(source);
});

test('live preview architecture claims are bound to the guarded backend implementation', async () => {
  const [controllerSource, configServiceSource, profitSafetySource] = await Promise.all([
    readFile(new URL('admin/config/admin-config.controller.ts', backendModulesRoot), 'utf8'),
    readFile(new URL('admin/config/admin-config.service.ts', backendModulesRoot), 'utf8'),
    readFile(new URL('profit/profit-safety.service.ts', backendModulesRoot), 'utf8'),
  ]);

  const previewRoute = extractBetween(
    controllerSource,
    "@Post('profit-safety-preview')",
    "@Get('versions')",
  );
  assert.match(previewRoute, /@Post\('profit-safety-preview'\)/);
  assert.match(previewRoute, /@RequirePermission\('config:update'\)/);
  assert.match(previewRoute, /return this\.configService\.previewProfitSafety\(body\);/);
  assert.doesNotMatch(previewRoute, /@AuditLog\b/);

  const batchRoute = extractBetween(
    controllerSource,
    "@Put('batch')",
    "@Get(':key')",
  );
  assert.match(batchRoute, /@Put\('batch'\)/);
  assert.match(batchRoute, /@RequirePermission\('config:update'\)/);
  assert.match(batchRoute, /@AuditLog\(/);
  assert.match(batchRoute, /return this\.configService\.batchUpdate\(dto, adminUserId\);/);

  const previewMethod = extractBalancedBlock(
    configServiceSource,
    'async previewProfitSafety(input: unknown)',
    '{',
    '}',
  );
  assert.match(previewMethod, /return this\.profitSafety\.preview\(this\.normalizePreview\(input\)\);/);

  const batchUpdateMethod = extractBalancedBlock(
    configServiceSource,
    'async batchUpdate(dto: BatchUpdateConfigDto, adminUserId: string)',
    '{',
    '}',
  );
  assert.match(batchUpdateMethod, /this\.profitSafety\.withCandidateChange\(\{/);
  assert.match(batchUpdateMethod, /ruleUpdates,/);

  const safetyLockMethod = extractBalancedBlock(
    profitSafetySource,
    'async withSafetyLock<T>',
    '{',
    '}',
  );
  assert.match(safetyLockMethod, /Prisma\.TransactionIsolationLevel\.Serializable/);
  const advisoryLockMethod = extractBalancedBlock(
    profitSafetySource,
    'private async takeSafetyLock',
    '{',
    '}',
  );
  assert.match(advisoryLockMethod, /pg_advisory_xact_lock/);

  const previewSafetyMethod = extractBalancedBlock(
    profitSafetySource,
    'async preview(change: ProfitSafetyCandidateChange = {})',
    '{',
    '}',
  );
  assert.match(previewSafetyMethod, /return this\.withSafetyLock\(async \(tx\) =>/);
  assert.match(previewSafetyMethod, /this\.buildContext\(tx, change, false\)/);
  for (const persistencePattern of [
    /ruleVersion\.create/,
    /ruleConfig\.(?:create|update|upsert|delete)/,
    /\b(?:auditLog|audit|auditService)\s*\.\s*(?:create|update|upsert|delete|write|log)\s*\(/i,
  ]) {
    assert.doesNotMatch(previewSafetyMethod, persistencePattern);
  }

  const buildContextMethod = extractBalancedBlock(
    profitSafetySource,
    'private async buildContext(',
    '{',
    '}',
  );
  assert.match(buildContextMethod, /this\.loadRuleSnapshot\(tx\)/);
  assert.match(buildContextMethod, /this\.loadActiveSkus\(tx\)/);
  assert.match(buildContextMethod, /this\.validator\.evaluate\(candidate\)/);
  for (const persistencePattern of [
    /ruleConfig\.(?:create|update|upsert|delete|updateMany|createMany|deleteMany)/,
    /ruleVersion\.(?:create|update|upsert|delete|updateMany|createMany|deleteMany)/,
    /\b(?:auditLog|audit|auditService)\s*\.\s*(?:create|update|upsert|delete|updateMany|createMany|deleteMany|write|log)\s*\(/i,
  ]) {
    assert.doesNotMatch(buildContextMethod, persistencePattern);
  }

  const candidateChangeMethod = extractBalancedBlock(
    profitSafetySource,
    'async withCandidateChange<T>',
    '{',
    '}',
  );
  assert.match(candidateChangeMethod, /return this\.withSafetyLock\(async \(tx\) =>/);
  assert.match(candidateChangeMethod, /this\.buildContext\(tx, change, true\)/);
  assert.match(candidateChangeMethod, /ruleVersion\.create/);
});

test('admin architecture documents VIP and normal candidate safety preview guarantees', async () => {
  const doc = await readFile(new URL('../../docs/architecture/admin-frontend.md', import.meta.url), 'utf8');

  assert.match(doc, /VIP 系统配置页/);
  assert.match(doc, /普通用户系统配置页/);
  assert.match(doc, /useConfigProfitSafetyPreview/);
  assert.match(doc, /500ms/);
  assert.match(doc, /config:update/);
  assert.match(doc, /比例合计非法或存在字段校验错误时不预检/);
  assert.match(doc, /候选结果不写入 `RuleConfig`/);
  assert.match(doc, /候选结果不写入[^。\n]*(?:版本历史|配置版本)/);
  assert.match(doc, /候选结果不写入[^。\n]*(?:audit records|审计记录)/);
  assert.match(doc, /保存时.*Serializable.*advisory lock.*原子.*硬校验/);
});
