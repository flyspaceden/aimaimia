import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test, { after } from 'node:test';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const testOutputDir = resolve(adminRoot, '.tmp/admin-error-message-test');
const testOutputParent = resolve(adminRoot, '.tmp');
const cleanup = () => {
  rmSync(testOutputDir, { force: true, recursive: true });
  try {
    rmdirSync(testOutputParent);
  } catch {
    // Preserve a non-empty shared temporary directory.
  }
};

process.once('exit', cleanup);
after(cleanup);

rmSync(testOutputDir, { force: true, recursive: true });
mkdirSync(testOutputDir, { recursive: true });
writeFileSync(resolve(testOutputDir, 'package.json'), '{"type":"commonjs"}');
execFileSync(process.execPath, [
  resolve(adminRoot, 'node_modules/typescript/bin/tsc'),
  '--target', 'ES2022',
  '--module', 'commonjs',
  '--moduleResolution', 'node',
  '--strict',
  '--skipLibCheck',
  '--rootDir', 'src/utils',
  '--outDir', '.tmp/admin-error-message-test',
  'src/utils/adminErrorMessage.ts',
], { cwd: adminRoot, stdio: 'inherit' });

const require = createRequire(import.meta.url);
const { getAdminErrorMessage, sanitizeAdminErrorMessage } = require(resolve(testOutputDir, 'adminErrorMessage.js'));

test('never exposes backend error identifiers through the shared administrator error formatter', () => {
  assert.equal(
    sanitizeAdminErrorMessage('INVALID_CAPTAIN_CONFIG'),
    '团长预包装海鲜激励配置不完整或参数无效',
  );
  assert.equal(
    sanitizeAdminErrorMessage('INCOMPLETE_RULE_CONFIG_SNAPSHOT:CAPTAIN_SEAFOOD_CONFIG'),
    '基础配置尚未完成，请补全相关配置后重试',
  );
  assert.equal(
    sanitizeAdminErrorMessage('ORDER_PROFIT_COST_MISSING'),
    '商品成本缺失，暂不能完成利润核算',
  );
  assert.equal(
    sanitizeAdminErrorMessage('SOME_UNRECOGNIZED_INTERNAL_CODE'),
    '操作未完成，请稍后重试',
  );
  assert.equal(sanitizeAdminErrorMessage('Request failed with status code 500'), '操作未完成，请稍后重试');
  assert.equal(sanitizeAdminErrorMessage('Order profit snapshot is invalid'), '操作未完成，请稍后重试');
  assert.equal(sanitizeAdminErrorMessage('商品库存不足'), '商品库存不足');
});

test('reads raw Axios response data through the same Chinese-only policy', () => {
  assert.equal(
    getAdminErrorMessage({ response: { data: { error: { message: 'CAPTAIN_PROFIT_SAFETY_VIOLATION' } } } }, '保存失败'),
    '当前配置未通过平台利润安全校验',
  );
});

test('shared client and profit workflow do not append raw error identifiers or internal ids', () => {
  const clientSource = readFileSync(resolve(adminRoot, 'src/api/client.ts'), 'utf8');
  const profitSource = readFileSync(resolve(adminRoot, 'src/api/profit-reconciliation.ts'), 'utf8');
  const rollbackSource = readFileSync(resolve(adminRoot, 'src/components/ConfigVersionRollbackButton.tsx'), 'utf8');
  const settlementSource = readFileSync(resolve(adminRoot, 'src/pages/captain/settlements.tsx'), 'utf8');
  assert.match(clientSource, /sanitizeAdminErrorMessage/);
  assert.match(profitSource, /sanitizeAdminErrorMessage/);
  assert.match(rollbackSource, /sanitizeAdminErrorMessage/);
  assert.match(settlementSource, /getAdminErrorMessage\(record\.reviewBlockedReason/);
  assert.doesNotMatch(profitSource, /错误码 \$\{code\}/);
  assert.doesNotMatch(profitSource, /订单项 \$\{orderItemIds\.join/);
});
