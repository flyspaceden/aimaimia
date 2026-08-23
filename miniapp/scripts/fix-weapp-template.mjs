import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseTemplatePath = path.join(projectRoot, 'dist', 'base.wxml');
const unsupportedPadding = ' padding="{{i.p12||[0,0,0,0]}}"';

assert.ok(fs.existsSync(baseTemplatePath), 'Taro 未生成 dist/base.wxml，无法执行微信 WebView 兼容处理');

const source = fs.readFileSync(baseTemplatePath, 'utf8');
const occurrenceCount = source.split(unsupportedPadding).length - 1;

assert.ok(
  occurrenceCount > 0,
  'Taro base.wxml 结构已变化，请重新审核 ScrollView padding 兼容处理，禁止静默跳过',
);

const compatibleSource = source.split(unsupportedPadding).join('');
assert.doesNotMatch(
  compatibleSource,
  /<scroll-view[^>]*\spadding=/,
  'base.wxml 仍包含 WebView 不支持的 ScrollView padding 属性',
);

fs.writeFileSync(baseTemplatePath, compatibleSource);
console.log(`已移除 ${occurrenceCount} 处 Taro ScrollView padding 兼容属性`);
