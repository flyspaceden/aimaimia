import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/orders/detail.tsx', import.meta.url), 'utf8');

test('order detail print buttons use the local seller picking sheet', () => {
  assert.match(source, /import \{[\s\S]*printSellerWaybill[\s\S]*\} from '@\/utils\/waybillPrint';/);
  assert.match(source, /const handlePrintWaybill = \(\) => \{/);
  assert.match(source, /printSellerWaybill\(order\)/);
  assert.doesNotMatch(source, /toAbsoluteApiUrl\(order\.shipment\?\.waybillPrintUrl\)/);
  assert.doesNotMatch(source, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
});
