import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync('app/company/[id].tsx', 'utf8');

test('company inspection reports open in the app browser preview instead of the system link handler', () => {
  assert.match(source, /import \* as WebBrowser from 'expo-web-browser';/);
  assert.match(source, /getInspectionReportPreviewUrl\(report\.id\)/);
  assert.match(source, /await WebBrowser\.openBrowserAsync\(previewUrl,/);
  assert.doesNotMatch(source, /Linking\.openURL\(report\.fileUrl\)/);
});

test('unsupported reports are disabled and use a clear preview label', () => {
  assert.match(source, /disabled=\{!report\.previewAvailable\}/);
  assert.match(source, /accessibilityState=\{\{ disabled: !report\.previewAvailable \}\}/);
  assert.match(source, /'暂不支持预览'/);
});
