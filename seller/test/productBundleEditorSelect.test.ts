import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const editSource = readFileSync(resolve(__dirname, '../src/pages/products/edit.tsx'), 'utf8');

test('bundle SKU picker resets the Ant Design Select after adding an item', () => {
  assert.match(editSource, /const \[skuPickerResetKey, setSkuPickerResetKey\] = useState\(0\);/);
  assert.match(editSource, /key=\{skuPickerResetKey\}/);
  assert.match(editSource, /setSkuPickerResetKey\(\(key\) => key \+ 1\)/);
});

test('bundle SKU picker ignores the trailing search event emitted by selection', () => {
  assert.match(editSource, /const ignoreNextSkuSearchRef = useRef\(false\);/);
  assert.match(editSource, /if \(ignoreNextSkuSearchRef\.current\) \{/);
  assert.match(editSource, /ignoreNextSkuSearchRef\.current = true;/);
  assert.match(editSource, /setTimeout\(\(\) => \{/);
});
