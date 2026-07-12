import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const settings = readFileSync(resolve(adminRoot, 'src/pages/captain/settings.tsx'), 'utf8');
const selector = readFileSync(resolve(adminRoot, 'src/pages/captain/ScopeEntitySelect.tsx'), 'utf8');
const api = readFileSync(resolve(adminRoot, 'src/api/captain.ts'), 'utf8');

test('captain scope fields use searchable entity selectors instead of raw id tags', () => {
  const scopeSection = settings.slice(
    settings.indexOf('<SectionTitle>适用范围</SectionTitle>'),
    settings.indexOf('<SectionTitle>逐单利润奖励</SectionTitle>'),
  );

  assert.match(scopeSection, /ScopeEntitySelect type="CATEGORY"/);
  assert.equal((scopeSection.match(/ScopeEntitySelect type="PRODUCT"/g) || []).length, 2);
  assert.match(scopeSection, /ScopeEntitySelect type="COMPANY"/);
  assert.doesNotMatch(scopeSection, /mode="tags"/);
  assert.match(api, /getCaptainScopeOptions[\s\S]*?\/admin\/captain\/scope-options/);
});

test('scope selector loads on focus, searches remotely and paginates', () => {
  assert.match(selector, /useInfiniteQuery\(/);
  assert.match(selector, /enabled: open \|\| selectedIds\.length > 0/);
  assert.match(selector, /onFocus=\{\(\) => setOpen\(true\)\}/);
  assert.match(selector, /onSearch=\{\(nextKeyword\)/);
  assert.match(selector, /onPopupScroll=\{handlePopupScroll\}/);
  assert.match(selector, /filterOption=\{false\}/);
});

test('every captain parameter explanation includes a plain meaning and example', () => {
  const meaningCount = (settings.match(/\bmeaning:/g) || []).length;
  const exampleCount = (settings.match(/\bexample:/g) || []).length;

  assert.ok(meaningCount >= 29, `expected all explanations, found ${meaningCount}`);
  assert.equal(exampleCount, meaningCount);
  assert.match(settings, /什么意思：/);
  assert.match(settings, /举个例子：/);
  assert.match(settings, /还要一起看：/);
});
