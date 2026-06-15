import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('home search and drawn lottery hint appear below mission copy', () => {
  const home = read('app/(tabs)/home.tsx');
  const missionSecondLine = home.indexOf('{HOME_MISSION_LINES[1]}');
  const searchBar = home.indexOf('styles.searchBar');
  const drawnHint = home.indexOf('styles.drawnHint');

  assert.notEqual(missionSecondLine, -1);
  assert.notEqual(searchBar, -1);
  assert.notEqual(drawnHint, -1);
  assert.ok(missionSecondLine < searchBar);
  assert.ok(searchBar < drawnHint);
});
