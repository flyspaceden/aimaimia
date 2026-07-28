import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const queuePage = readFileSync(
  'admin/src/pages/bonus/queue-config.tsx',
  'utf8',
);
const previewUtils = readFileSync(
  'admin/src/utils/configProfitSafetyPreview.ts',
  'utf8',
);
const adminTypes = readFileSync('admin/src/types/index.ts', 'utf8');

test('queue config previews the exact unsaved candidate with the shared profit safety service', () => {
  assert.match(queuePage, /getProfitSafetySummary/);
  assert.match(queuePage, /useConfigProfitSafetyPreview/);
  assert.match(queuePage, /serializeQueueFormForProfitSafety/);
  assert.match(
    queuePage,
    /rewardPercentDisplay[\s\S]*?serialize:\s*\(value\)\s*=>\s*Number\(value\)\s*\/\s*100/,
  );
  assert.match(queuePage, /previewState=\{profitSafetyPreview\}/);
});

test('queue config makes platform-share consumption explicit and blocks an unsafe candidate', () => {
  assert.match(queuePage, /利润安全闸门/);
  assert.match(queuePage, /队列从利润中取走/);
  assert.match(queuePage, /普通用户订单的平台份额/);
  assert.match(queuePage, /VIP订单的平台份额/);
  assert.match(queuePage, /队列不是第八份利润/);
  assert.match(
    queuePage,
    /disabled=\{!dirty \|\| !canSave \|\| previewBlocksSave\}/,
  );
  assert.match(
    queuePage,
    /profitSafetyPreview\.kind !== 'candidate'[\s\S]*?!profitSafetyPreview\.summary\.safe/,
  );
});

test('queue profit safety fields and errors have administrator-facing contracts', () => {
  assert.match(
    previewUtils,
    /QUEUE_REWARD_ENABLED:\s*'全平台订单队列奖励开关'/,
  );
  assert.match(
    previewUtils,
    /QUEUE_REWARD_PERCENT:\s*'订单利润用于队列奖励的比例'/,
  );
  assert.match(
    previewUtils,
    /INVALID_QUEUE_REWARD_RATE:\s*'队列奖励比例存在无效值'/,
  );
  assert.match(adminTypes, /queueRewardProfitRate:\s*number/);
});
