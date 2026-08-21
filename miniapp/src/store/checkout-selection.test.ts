import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectCreatedCheckoutAddressIfActive, useCheckoutSelectionStore } from './checkout-selection';

vi.mock('@/session/clientState', () => ({ registerPrivateStateReset: vi.fn() }));

afterEach(() => useCheckoutSelectionStore.getState().clear());

describe('selectCreatedCheckoutAddressIfActive', () => {
  it('selects the newly created address for the active checkout session', () => {
    useCheckoutSelectionStore.getState().begin({ ownerRevision: 7, addressId: 'old-address', couponIds: [] });

    expect(selectCreatedCheckoutAddressIfActive({
      fromCheckout: true,
      addressId: 'new-address',
      accessToken: 'buyer-token',
      authRevision: 7,
    })).toBe(true);
    expect(useCheckoutSelectionStore.getState().addressId).toBe('new-address');
  });

  it('does not cross normal address management or a changed login session', () => {
    useCheckoutSelectionStore.getState().begin({ ownerRevision: 7, addressId: 'old-address', couponIds: [] });

    expect(selectCreatedCheckoutAddressIfActive({
      fromCheckout: false,
      addressId: 'normal-address',
      accessToken: 'buyer-token',
      authRevision: 7,
    })).toBe(false);
    expect(selectCreatedCheckoutAddressIfActive({
      fromCheckout: true,
      addressId: 'other-user-address',
      accessToken: 'buyer-token',
      authRevision: 8,
    })).toBe(false);
    expect(useCheckoutSelectionStore.getState().addressId).toBe('old-address');
  });
});
