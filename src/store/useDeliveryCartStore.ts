import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';
import { AppError, Result } from '../types';
import { DeliveryCart, DeliveryCartItem, DeliveryCartRepo } from '../repos/delivery';
import { useDeliveryAuthStore } from './useDeliveryAuthStore';

export const DELIVERY_CART_STORAGE_KEY = 'nongmai-delivery-cart';

const cartStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return localStorage.getItem(name);
    }
    return AsyncStorage.getItem(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.setItem(name, value);
      return;
    }
    await AsyncStorage.setItem(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(name);
      return;
    }
    await AsyncStorage.removeItem(name);
  },
};

const notLoggedInError: AppError = {
  code: 'FORBIDDEN',
  message: '配送账号未登录',
  displayMessage: '请先登录配送账号',
  retryable: false,
};

type DeliveryCartState = {
  hasHydrated: boolean;
  currentUnitId: string | null;
  items: DeliveryCartItem[];
  loading: boolean;
  setHasHydrated: (value: boolean) => void;
  replaceFromServer: (cart: DeliveryCart) => void;
  syncFromServer: () => Promise<Result<DeliveryCart>>;
  addItem: (skuId: string, quantity?: number) => Promise<Result<void>>;
  updateItem: (id: string, payload: { quantity?: number; isSelected?: boolean }) => Promise<Result<void>>;
  updateQty: (id: string, quantity: number) => Promise<Result<void>>;
  removeItem: (id: string) => Promise<Result<void>>;
  toggleSelect: (id: string) => Promise<Result<void>>;
  selectAll: () => Promise<Result<void>>;
  deselectAll: () => Promise<Result<void>>;
  clearLocal: () => void;
  selectedItems: () => DeliveryCartItem[];
  selectedCount: () => number;
  selectedTotal: () => number;
  totalCount: () => number;
};

const okVoid: Result<void> = { ok: true, data: undefined };

const ensureLoggedIn = (): Result<void> =>
  useDeliveryAuthStore.getState().isLoggedIn ? okVoid : { ok: false, error: notLoggedInError };

export const useDeliveryCartStore = create<DeliveryCartState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      currentUnitId: null,
      items: [],
      loading: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      replaceFromServer: (cart) =>
        set({
          currentUnitId: cart.currentUnitId,
          items: cart.items,
          loading: false,
        }),
      syncFromServer: async () => {
        const authState = ensureLoggedIn();
        if (!authState.ok) return authState as Result<DeliveryCart>;

        set({ loading: true });
        const result = await DeliveryCartRepo.getCart();
        if (result.ok) {
          get().replaceFromServer(result.data);
          return result;
        }
        set({ loading: false });
        return result;
      },
      addItem: async (skuId, quantity = 1) => {
        const authState = ensureLoggedIn();
        if (!authState.ok) return authState;

        const result = await DeliveryCartRepo.addItem({ skuId, quantity });
        if (!result.ok) return result as Result<void>;
        const syncResult = await get().syncFromServer();
        return syncResult.ok ? okVoid : (syncResult as Result<void>);
      },
      updateItem: async (id, payload) => {
        const authState = ensureLoggedIn();
        if (!authState.ok) return authState;

        const result = await DeliveryCartRepo.updateItem(id, payload);
        if (!result.ok) return result as Result<void>;
        const syncResult = await get().syncFromServer();
        return syncResult.ok ? okVoid : (syncResult as Result<void>);
      },
      updateQty: (id, quantity) => get().updateItem(id, { quantity }),
      removeItem: async (id) => {
        const authState = ensureLoggedIn();
        if (!authState.ok) return authState;

        const result = await DeliveryCartRepo.removeItem(id);
        if (!result.ok) return result as Result<void>;
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        }));
        return okVoid;
      },
      toggleSelect: async (id) => {
        const current = get().items.find((item) => item.id === id);
        if (!current) {
          return {
            ok: false,
            error: {
              code: 'NOT_FOUND',
              message: '配送购物车商品不存在',
              displayMessage: '商品不存在',
              retryable: false,
            },
          };
        }
        return get().updateItem(id, { isSelected: !current.isSelected });
      },
      selectAll: async () => {
        const targets = get().items.filter((item) => !item.isSelected);
        for (const item of targets) {
          const result = await get().updateItem(item.id, { isSelected: true });
          if (!result.ok) return result;
        }
        return okVoid;
      },
      deselectAll: async () => {
        const targets = get().items.filter((item) => item.isSelected);
        for (const item of targets) {
          const result = await get().updateItem(item.id, { isSelected: false });
          if (!result.ok) return result;
        }
        return okVoid;
      },
      clearLocal: () => set({ currentUnitId: null, items: [], loading: false }),
      selectedItems: () => get().items.filter((item) => item.isSelected),
      selectedCount: () => get().items.filter((item) => item.isSelected).length,
      selectedTotal: () =>
        get()
          .items.filter((item) => item.isSelected)
          .reduce((sum, item) => sum + item.lineAmount, 0),
      totalCount: () => get().items.reduce((sum, item) => sum + item.quantity, 0),
    }),
    {
      name: DELIVERY_CART_STORAGE_KEY,
      storage: createJSONStorage(() => cartStorage),
      partialize: (state) => ({
        currentUnitId: state.currentUnitId,
        items: state.items,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
