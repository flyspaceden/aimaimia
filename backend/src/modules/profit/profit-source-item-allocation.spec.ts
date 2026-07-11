import { buildCumulativeRefundTargets } from './order-profit-refund.service';
import {
  allocatePairedProfitSourcesToItems,
  allocateProfitSourcesToItems,
} from './profit-source-item-allocation';

describe('revision-aware profit source allocation', () => {
  it('allocates sources against shared item capacities instead of rounding each source independently', () => {
    const matrix = allocateProfitSourcesToItems(
      [
        { id: 'member', amountCents: 1 },
        { id: 'platform', amountCents: 1 },
      ],
      [
        { id: 'item-a', capacityCents: 1 },
        { id: 'item-b', capacityCents: 1 },
      ],
    );

    expect(matrix).toEqual({
      member: { 'item-a': 1, 'item-b': 0 },
      platform: { 'item-a': 0, 'item-b': 1 },
    });
    expect(matrix.member['item-a'] + matrix.platform['item-a']).toBe(1);
    expect(matrix.member['item-b'] + matrix.platform['item-b']).toBe(1);
  });

  it('accumulates quantity and amount-only refunds for the same item', () => {
    const targets = buildCumulativeRefundTargets(
      [{
        orderItemId: 'item-a',
        quantity: 2,
        netGoodsRevenueCents: 1_000,
        distributableProfitShareCents: 100,
        captainEligible: true,
      }],
      [
        {
          refundId: 'refund-quantity', orderItemId: 'item-a', quantity: 1,
          goodsAmountCents: 500,
        },
        {
          refundId: 'refund-amount', orderItemId: 'item-a', quantity: 0,
          goodsAmountCents: 250,
        },
      ],
    );

    expect(targets['item-a']).toEqual(expect.objectContaining({
      refundedQuantity: 1,
      refundedGoodsAmountCents: 750,
      ratioNumerator: 750,
      ratioDenominator: 1_000,
      cumulativeProfitTargetCents: 75,
    }));
  });

  it('reuses the direct captain item rounding for the matching negative hold', () => {
    const pair = allocatePairedProfitSourcesToItems(
      [{ id: 'captain-direct', amountCents: 1 }],
      [{ id: 'direct-hold', amountCents: 1 }],
      [
        { id: 'item-a', capacityCents: 1 },
        { id: 'item-b', capacityCents: 1 },
      ],
    );

    expect(pair.positive['captain-direct']).toEqual({ 'item-a': 1, 'item-b': 0 });
    expect(pair.hold['direct-hold']).toEqual({ 'item-a': 1, 'item-b': 0 });
    expect(pair.itemNetCents).toEqual({ 'item-a': 0, 'item-b': 0 });
  });

  it('pairs monthly paid plus release with the hold without a one-cent partial-refund residue', () => {
    const pair = allocatePairedProfitSourcesToItems(
      [
        { id: 'monthly-paid', amountCents: 1 },
        { id: 'monthly-release', amountCents: 1 },
      ],
      [{ id: 'monthly-hold', amountCents: 2 }],
      [
        { id: 'item-a', capacityCents: 1 },
        { id: 'item-b', capacityCents: 1 },
      ],
    );

    expect(pair.positive).toEqual({
      'monthly-paid': { 'item-a': 1, 'item-b': 0 },
      'monthly-release': { 'item-a': 0, 'item-b': 1 },
    });
    expect(pair.hold['monthly-hold']).toEqual({ 'item-a': 1, 'item-b': 1 });
    expect(pair.itemNetCents).toEqual({ 'item-a': 0, 'item-b': 0 });

    const firstItemRefundNet = pair.positive['monthly-paid']['item-a']
      + pair.positive['monthly-release']['item-a']
      - pair.hold['monthly-hold']['item-a'];
    expect(firstItemRefundNet).toBe(0);
  });

  it('keeps an unmatched monthly hold allocated when a draft has released only part of it', () => {
    const pair = allocatePairedProfitSourcesToItems(
      [{ id: 'monthly-release', amountCents: 7 }],
      [{ id: 'monthly-hold', amountCents: 10 }],
      [
        { id: 'item-a', capacityCents: 6 },
        { id: 'item-b', capacityCents: 4 },
      ],
      { allowUnmatchedHold: true },
    );

    expect(Object.values(pair.positive['monthly-release']).reduce((sum, cents) => sum + cents, 0))
      .toBe(7);
    expect(Object.values(pair.hold['monthly-hold']).reduce((sum, cents) => sum + cents, 0))
      .toBe(10);
    expect(Object.values(pair.itemNetCents).reduce((sum, cents) => sum + cents, 0))
      .toBe(-3);
    expect(Object.values(pair.itemNetCents).every((cents) => cents <= 0)).toBe(true);
  });
});
