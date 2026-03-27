/**
 * 结算页临时状态
 * 用于 checkout 子页面（地址选择、红包选择）通过 router.back() 传递选择结果
 * vipPackageSelection 通过 AsyncStorage 持久化（防止用户中途退出丢失选择）
 */
import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/** VIP 赠品套餐选择 */
export interface VipPackageSelection {
  packageId: string;        // 选中的档位 ID
  giftOptionId: string;
  title: string;
  coverMode?: string;
  coverUrl?: string;
  totalPrice: number;
  price: number;            // VIP 价格
  items: Array<{
    skuId: string;
    productTitle: string;
    productImage: string | null;
    skuTitle: string;
    price: number;
    quantity: number;
  }>;
}

/**
 * AsyncStorage 适配器（与 useCartStore 一致）
 * Web 平台回退到 localStorage
 */
const checkoutStorage: StateStorage = {
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

interface CheckoutState {
  // 选中的地址 ID
  selectedAddressId: string | null;
  // 选中的红包 ID 列表
  selectedCouponIds: string[];
  // 红包总抵扣金额
  couponDiscount: number;
  // VIP 赠品套餐选择（持久化）
  vipPackageSelection: VipPackageSelection | null;

  setSelectedAddress: (id: string) => void;
  setSelectedCoupons: (ids: string[], discount: number) => void;
  clearCoupons: () => void;
  setVipPackageSelection: (selection: VipPackageSelection | null) => void;
  clearVipPackageSelection: () => void;
  reset: () => void;
}

export const useCheckoutStore = create<CheckoutState>()(
  persist(
    (set) => ({
      selectedAddressId: null,
      selectedCouponIds: [],
      couponDiscount: 0,
      vipPackageSelection: null,

      setSelectedAddress: (id) => set({ selectedAddressId: id }),
      setSelectedCoupons: (ids, discount) => set({ selectedCouponIds: ids, couponDiscount: discount }),
      clearCoupons: () => set({ selectedCouponIds: [], couponDiscount: 0 }),
      setVipPackageSelection: (selection) => set({ vipPackageSelection: selection }),
      clearVipPackageSelection: () => set({ vipPackageSelection: null }),
      reset: () => set({ selectedAddressId: null, selectedCouponIds: [], couponDiscount: 0, vipPackageSelection: null }),
    }),
    {
      name: 'checkout-store',
      storage: createJSONStorage(() => checkoutStorage),
      // 只持久化 vipPackageSelection，其他字段为临时状态
      partialize: (state) => ({ vipPackageSelection: state.vipPackageSelection }),
    },
  ),
);
