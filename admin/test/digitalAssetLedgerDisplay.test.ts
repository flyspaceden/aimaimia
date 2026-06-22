import test from 'node:test';
import assert from 'node:assert/strict';
import { getDigitalAssetLedgerStatusMeta } from '../src/pages/digital-assets/ledgerDisplay.ts';

test('shows paid consumption assets as frozen until receipt confirmation', () => {
  assert.deepEqual(getDigitalAssetLedgerStatusMeta({
    status: 'FROZEN',
    releaseHint: '确认收货后释放',
  }), {
    text: '冻结中',
    color: 'cyan',
    description: '确认收货后释放',
  });
});

test('does not show a status tag for ordinary released ledgers without status', () => {
  assert.equal(getDigitalAssetLedgerStatusMeta({}), null);
});
