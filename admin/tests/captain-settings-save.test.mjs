import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(resolve(adminRoot, 'src/pages/captain/settings.tsx'), 'utf8');

test('submits the non-editable V3 contract metadata with captain settings', () => {
  const handleSubmit = source.slice(
    source.indexOf('const handleSubmit = async () => {'),
    source.indexOf('const rateRules ='),
  );

  assert.match(
    handleSubmit,
    /const next = normalizeConfig\(\{\s*\.\.\.values,\s*schemaVersion: 3,\s*programCode: PROGRAM_CODE,\s*\}\);/s,
  );
});
