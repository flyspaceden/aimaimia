declare const describe: any;
declare const it: any;
declare const expect: any;

import { getCartDisplayQuantity } from '../cartCounts';

describe('cart display quantity', () => {
  it('does not count lottery prize quantities as regular cart goods', () => {
    const quantity = getCartDisplayQuantity([
      { quantity: 1, isPrize: true, isLocked: true },
      { quantity: 30, isPrize: true, isLocked: true },
    ]);

    expect(quantity).toBe(0);
  });

  it('counts only purchasable non-prize quantities for cart badges', () => {
    const quantity = getCartDisplayQuantity([
      { quantity: 2 },
      { quantity: 3, isPrize: false },
      { quantity: 99, isPrize: true },
      { quantity: 4, unavailableReason: 'OUT_OF_STOCK' },
    ]);

    expect(quantity).toBe(5);
  });
});
