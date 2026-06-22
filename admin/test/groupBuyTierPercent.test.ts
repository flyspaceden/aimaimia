import test from 'node:test';
import assert from 'node:assert/strict';
import {
  basisPointsToPercent,
  percentToBasisPoints,
  toTierFormValues,
  toTierPayloadValues,
} from '../src/pages/group-buy/tierPercent.ts';

test('converts stored basis points into admin percent values', () => {
  assert.equal(basisPointsToPercent(1000), 10);
  assert.equal(basisPointsToPercent(1250), 12.5);
  assert.deepEqual(toTierFormValues([
    { sequence: 1, basisPoints: 1000, label: '第一位好友' },
    { sequence: 2, basisPoints: 2000, label: '第二位好友' },
    { sequence: 3, basisPoints: 7000, label: '第三位好友' },
  ]), [
    { sequence: 1, percent: 10, label: '第一位好友' },
    { sequence: 2, percent: 20, label: '第二位好友' },
    { sequence: 3, percent: 70, label: '第三位好友' },
  ]);
});

test('converts admin percent values into stored basis points and allows totals above 100 percent', () => {
  assert.equal(percentToBasisPoints(10), 1000);
  assert.equal(percentToBasisPoints(12.5), 1250);
  assert.deepEqual(toTierPayloadValues([
    { sequence: 1, percent: 10, label: '第一位好友' },
    { sequence: 2, percent: 20, label: '第二位好友' },
    { sequence: 3, percent: 80, label: '第三位好友' },
  ]), [
    { sequence: 1, basisPoints: 1000, label: '第一位好友' },
    { sequence: 2, basisPoints: 2000, label: '第二位好友' },
    { sequence: 3, basisPoints: 8000, label: '第三位好友' },
  ]);
});
