import { getPrizeUnavailableReason, isPrizeAvailable } from './prize-availability.util';

describe('prize availability', () => {
  it('treats active NO_PRIZE as available without SKU', () => {
    expect(isPrizeAvailable({ type: 'NO_PRIZE', isActive: true })).toBe(true);
  });

  it('rejects physical prize when SKU is inactive', () => {
    const reason = getPrizeUnavailableReason({
      type: 'THRESHOLD_GIFT',
      isActive: true,
      skuId: 'sku1',
      sku: {
        id: 'sku1',
        status: 'INACTIVE',
        product: { id: 'p1', status: 'ACTIVE' },
      },
    });

    expect(reason).toBe('SKU_INACTIVE');
  });

  it('rejects physical prize when product is inactive', () => {
    const reason = getPrizeUnavailableReason({
      type: 'DISCOUNT_BUY',
      isActive: true,
      skuId: 'sku1',
      sku: {
        id: 'sku1',
        status: 'ACTIVE',
        product: { id: 'p1', status: 'INACTIVE' },
      },
    });

    expect(reason).toBe('PRODUCT_INACTIVE');
  });
});
