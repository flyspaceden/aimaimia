import {
  buildReceivedOrderBackfillWhere,
  parseBackfillOptions,
} from '../../../scripts/backfill-digital-assets';

describe('digital asset backfill script helpers', () => {
  it('defaults to dry-run with a bounded batch size', () => {
    expect(parseBackfillOptions([], {})).toEqual({
      batchSize: 100,
      dryRun: true,
    });
  });

  it('requires explicit execute flag before mutating records', () => {
    expect(parseBackfillOptions(['--execute', '--batch-size=25'], {})).toEqual({
      batchSize: 25,
      dryRun: false,
    });
  });

  it('selects received orders without prior cumulative spend credit ledger', () => {
    expect(buildReceivedOrderBackfillWhere()).toEqual({
      status: 'RECEIVED',
      deletedAt: null,
      digitalAssetLedgers: {
        none: {
          type: 'CUMULATIVE_SPEND_CREDIT',
          direction: 'CREDIT',
        },
      },
    });
  });
});
