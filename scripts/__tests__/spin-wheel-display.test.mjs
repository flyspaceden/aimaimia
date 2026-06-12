import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('lottery spin wheel renders complete prize names without fixed truncation', () => {
  const spinWheel = read('src/components/effects/SpinWheel.tsx');
  const lottery = read('app/lottery.tsx');

  assert.doesNotMatch(spinWheel, /truncateText\(prize\.name,\s*5\)/);
  assert.match(spinWheel, /buildWheelLabelLines\(prize\.name\)/);
  assert.match(spinWheel, /seg\.labelLines\.map/);
  assert.match(spinWheel, /<TSpan/);
  assert.doesNotMatch(lottery, /numberOfLines=\{1\}[\s\S]*\{p\.name\}/);
});

test('lottery spin wheel segment colors are assigned per prize item', () => {
  const spinWheel = read('src/components/effects/SpinWheel.tsx');

  assert.match(spinWheel, /SEGMENT_PALETTE/);
  assert.match(spinWheel, /getSegmentTheme\(prize\.type,\s*i,\s*prize\.id\)/);
  assert.doesNotMatch(spinWheel, /Record<string,\s*\{\s*main:\s*string;\s*alt:\s*string;\s*text:\s*string\s*\}>/);
  assert.doesNotMatch(spinWheel, /const fill = i % 2 === 0 \? theme\.main : theme\.alt/);
});
