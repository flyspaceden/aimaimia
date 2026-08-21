import { create } from 'zustand';
import { registerPrivateStateReset } from '@/session/clientState';

type CartSelectionState = {
  ownerUserId: string;
  prizeSelections: Record<string, boolean>;
  begin: (userId: string) => void;
  selectPrize: (cartItemId: string, selected: boolean) => void;
  selectPrizes: (cartItemIds: string[], selected: boolean) => void;
  forgetPrize: (cartItemId: string) => void;
  clear: () => void;
};

/**
 * App 中购物车的勾选状态本来就是客户端状态：普通商品同步到后端，
 * DISCOUNT_BUY 等非门槛奖品只在当前客户端决定是否参与结算。小程序用
 * cartItemId 保存这部分覆盖，结算时仍把 cartItemId 交给后端做奖品资格校验。
 */
export const useCartSelectionStore = create<CartSelectionState>((set, get) => ({
  ownerUserId: '',
  prizeSelections: {},
  begin: (userId) => {
    if (get().ownerUserId === userId) return;
    set({ ownerUserId: userId, prizeSelections: {} });
  },
  selectPrize: (cartItemId, selected) => set((state) => ({
    prizeSelections: { ...state.prizeSelections, [cartItemId]: selected },
  })),
  selectPrizes: (cartItemIds, selected) => set((state) => ({
    prizeSelections: cartItemIds.reduce<Record<string, boolean>>(
      (next, id) => ({ ...next, [id]: selected }),
      state.prizeSelections,
    ),
  })),
  forgetPrize: (cartItemId) => set((state) => {
    if (!(cartItemId in state.prizeSelections)) return state;
    const next = { ...state.prizeSelections };
    delete next[cartItemId];
    return { prizeSelections: next };
  }),
  clear: () => set({ ownerUserId: '', prizeSelections: {} }),
}));

registerPrivateStateReset(() => useCartSelectionStore.getState().clear());
