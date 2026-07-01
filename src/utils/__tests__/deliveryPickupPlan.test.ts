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
        1,
      ).ok,
    ).toBe(false);
  });

  it('rejects unknown cart item ids and non-positive plan rows', () => {
    expect(
      validateDeliveryPickupPlan(
        [{ cartItemId: 'ci1', quantity: 5 }],
        [{ cartItemId: 'ci2', batchNo: 1, quantity: 1 }],
        1,
      ).ok,
    ).toBe(false);
    expect(
      validateDeliveryPickupPlan(
        [{ cartItemId: 'ci1', quantity: 5 }],
        [{ cartItemId: 'ci1', batchNo: 0, quantity: 5 }],
        1,
      ).ok,
    ).toBe(false);
  });

  it('rejects pickup counts that exceed total selected quantity', () => {
    const result = validateDeliveryPickupPlan(
      [{ cartItemId: 'ci1', quantity: 2 }],
      [
        { cartItemId: 'ci1', batchNo: 1, quantity: 1 },
        { cartItemId: 'ci1', batchNo: 2, quantity: 1 },
      ],
      3,
    );

    expect(result).toEqual({ ok: false, message: '提货次数不能超过所选商品总数量' });
  });

  it('rejects multi-pickup plans that leave a planned batch empty', () => {
    const result = validateDeliveryPickupPlan(
      [{ cartItemId: 'ci1', quantity: 3 }],
      [
        { cartItemId: 'ci1', batchNo: 1, quantity: 1 },
        { cartItemId: 'ci1', batchNo: 3, quantity: 2 },
      ],
      3,
    );

    expect(result).toEqual({ ok: false, message: '提货计划必须覆盖每个计划批次' });
  });
});
