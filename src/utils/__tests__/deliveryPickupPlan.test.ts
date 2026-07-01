import {
  buildDefaultDeliveryPickupPlan,
  validateDeliveryPickupPlan,
} from '../deliveryPickupPlan';

describe('deliveryPickupPlan', () => {
  it('splits quantity remainder into earlier batches', () => {
    expect(buildDefaultDeliveryPickupPlan([{ cartItemId: 'ci1', quantity: 5 }], 2)).toEqual([
      { cartItemId: 'ci1', batchNo: 1, quantity: 3 },
      { cartItemId: 'ci1', batchNo: 2, quantity: 2 },
    ]);
  });

  it('does not create zero-quantity rows when batch count exceeds item quantity', () => {
    expect(buildDefaultDeliveryPickupPlan([{ cartItemId: 'ci1', quantity: 2 }], 3)).toEqual([
      { cartItemId: 'ci1', batchNo: 1, quantity: 1 },
      { cartItemId: 'ci1', batchNo: 2, quantity: 1 },
    ]);
  });

  it('rejects plan totals that do not equal cart quantities', () => {
    expect(
      validateDeliveryPickupPlan(
        [{ cartItemId: 'ci1', quantity: 5 }],
        [{ cartItemId: 'ci1', batchNo: 1, quantity: 4 }],
      ).ok,
    ).toBe(false);
  });

  it('rejects unknown cart item ids and non-positive plan rows', () => {
    expect(
      validateDeliveryPickupPlan(
        [{ cartItemId: 'ci1', quantity: 5 }],
        [{ cartItemId: 'ci2', batchNo: 1, quantity: 1 }],
      ).ok,
    ).toBe(false);
    expect(
      validateDeliveryPickupPlan(
        [{ cartItemId: 'ci1', quantity: 5 }],
        [{ cartItemId: 'ci1', batchNo: 0, quantity: 5 }],
      ).ok,
    ).toBe(false);
  });
});
