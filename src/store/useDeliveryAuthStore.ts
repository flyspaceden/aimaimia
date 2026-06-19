import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { DeliveryAuthSession, DeliveryAuthUser, DeliveryUnit } from '../repos/delivery';

export const DELIVERY_AUTH_STORAGE_KEY = 'nongmai-delivery-auth';

const secureStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return localStorage.getItem(name);
    }
    return SecureStore.getItemAsync(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.setItem(name, value);
      return;
    }
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(name);
      return;
    }
    await SecureStore.deleteItemAsync(name);
  },
};

type DeliveryAuthState = {
  hasHydrated: boolean;
  isLoggedIn: boolean;
  accessToken?: string;
  requiresUnit: boolean;
  currentUnitId: string | null;
  currentUnit: DeliveryUnit | null;
  user: DeliveryAuthUser | null;
  setHasHydrated: (value: boolean) => void;
  setSession: (session: DeliveryAuthSession) => void;
  updateProfile: (payload: Omit<DeliveryAuthSession, 'accessToken'>) => void;
  setCurrentUnit: (unit: DeliveryUnit | null) => void;
  clearSession: () => void;
};

export const useDeliveryAuthStore = create<DeliveryAuthState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      isLoggedIn: false,
      accessToken: undefined,
      requiresUnit: true,
      currentUnitId: null,
      currentUnit: null,
      user: null,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      setSession: (session) =>
        set({
          isLoggedIn: true,
          accessToken: session.accessToken,
          requiresUnit: session.requiresUnit,
          currentUnitId: session.currentUnitId,
          currentUnit: session.currentUnit,
          user: session.user,
        }),
      updateProfile: (payload) =>
        set((state) => ({
          isLoggedIn: state.isLoggedIn,
          accessToken: state.accessToken,
          requiresUnit: payload.requiresUnit,
          currentUnitId: payload.currentUnitId,
          currentUnit: payload.currentUnit,
          user: payload.user,
        })),
      setCurrentUnit: (unit) =>
        set({
          requiresUnit: !unit,
          currentUnitId: unit?.id ?? null,
          currentUnit: unit,
        }),
      clearSession: () => {
        const wasLoggedIn = get().isLoggedIn;
        set({
          isLoggedIn: false,
          accessToken: undefined,
          requiresUnit: true,
          currentUnitId: null,
          currentUnit: null,
          user: null,
        });
        if (!wasLoggedIn) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useDeliveryCartStore } = require('./useDeliveryCartStore');
          useDeliveryCartStore.getState().clearLocal();
        } catch {
          // ignore
        }
      },
    }),
    {
      name: DELIVERY_AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({
        isLoggedIn: state.isLoggedIn,
        accessToken: state.accessToken,
        requiresUnit: state.requiresUnit,
        currentUnitId: state.currentUnitId,
        currentUnit: state.currentUnit,
        user: state.user,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
