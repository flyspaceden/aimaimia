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

/** 仅限从结算流程新增地址时，且仍属于同一登录会话，才替换当前结算地址。 */
export function selectCreatedCheckoutAddressIfActive(input: {
  fromCheckout: boolean;
  addressId: string;
  accessToken?: string | null;
  authRevision: number;
}): boolean {
  if (!input.fromCheckout || !input.addressId || !input.accessToken) return false;
  const selection = useCheckoutSelectionStore.getState();
  if (selection.ownerRevision !== input.authRevision) return false;
  selection.selectAddress(input.addressId);
  return true;
}

registerPrivateStateReset(() => useCheckoutSelectionStore.getState().clear());
