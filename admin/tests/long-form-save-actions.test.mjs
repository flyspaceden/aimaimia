import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));

function readPage(relativePath) {
  return readFileSync(resolve(adminRoot, relativePath), 'utf8');
}

test('captain configuration keeps a save action after the final risk settings', () => {
  const source = readPage('src/pages/captain/settings.tsx');
  const riskSection = source.indexOf('<SectionTitle>风控</SectionTitle>');
  const bottomSave = source.indexOf('<Divider style={{ margin: \'8px 0 16px\' }} />', riskSection);

  assert.ok(riskSection >= 0, 'risk section must exist');
  assert.ok(bottomSave > riskSection, 'bottom save action must be after risk settings');
  assert.match(
    source.slice(bottomSave),
    /permission=\{PERMISSIONS\.CAPTAIN_SETTINGS\}[\s\S]*?onClick=\{handleSubmit\}/,
  );
});

test('coupon campaign drawer reuses its submit action in the footer', () => {
  const source = readPage('src/pages/coupons/campaign-form.tsx');

  assert.match(source, /const renderDrawerActions = \(\) => \([\s\S]*?formRef\.current\?\.submit\(\)/);
  assert.match(source, /extra=\{renderDrawerActions\(\)\}/);
  assert.match(source, /footer=\{<div[^>]*>\{renderDrawerActions\(\)\}<\/div>\}/);
});

test('group buy activity drawer exposes cancel and save actions in its footer', () => {
  const source = readPage('src/pages/group-buy/activities.tsx');
  const drawer = source.slice(source.indexOf("title={editing ? '编辑团购活动' : '新建团购活动'}"));

  assert.match(drawer, /footer=\{[\s\S]*?onClick=\{closeDrawer\}[\s\S]*?onClick=\{handleSubmit\}/);
});

test('VIP gift drawer exposes cancel and save actions in its footer', () => {
  const source = readPage('src/pages/vip-gifts/index.tsx');
  const drawer = source.slice(source.indexOf("title={editingRecord ? '编辑赠品方案' : '新增赠品方案'}"));

  assert.match(drawer, /footer=\{[\s\S]*?onClick=\{closeDrawer\}[\s\S]*?onClick=\{handleSubmit\}/);
});
