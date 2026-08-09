import { create } from 'zustand';
import { registerPrivateStateReset } from '@/session/clientState';
import type { CheckoutEligibleRequest } from '@/types';

type CheckoutSelectionState = {
  ownerRevision: number;
  addressId: string;
  couponIds: string[];
  couponRequest?: CheckoutEligibleRequest;
  begin: (input: {
    ownerRevision: number;
    addressId: string;
    couponIds: string[];
    couponRequest?: CheckoutEligibleRequest;
  }) => void;
  selectAddress: (addressId: string) => void;
  selectCoupons: (couponIds: string[]) => void;
  clear: () => void;
};

export const useCheckoutSelectionStore = create<CheckoutSelectionState>((set) => ({
  ownerRevision: -1,
  addressId: '',
  couponIds: [],
  begin: (input) => set({
    ownerRevision: input.ownerRevision,
    addressId: input.addressId,
    couponIds: [...input.couponIds],
    couponRequest: input.couponRequest,
  }),
  selectAddress: (addressId) => set({ addressId }),
  selectCoupons: (couponIds) => set({ couponIds: [...couponIds] }),
  clear: () => set({ ownerRevision: -1, addressId: '', couponIds: [], couponRequest: undefined }),
}));

registerPrivateStateReset(() => useCheckoutSelectionStore.getState().clear());
