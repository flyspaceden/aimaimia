/**
 * 购物车状态（Store）— 双模式购物车
 *
 * 数据流：
 * - 未登录（本地模式）：所有操作仅修改本地状态，通过 AsyncStorage 持久化，不调用服务端 API
 * - 已登录（服务端模式）：乐观更新 + 异步服务端同步，请求失败时回滚并提示
 * - 登录时调用 syncLocalCartToServer 将本地购物车合并到服务端
 */
import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Toast from 'react-native-toast-message';
import { CartMergeResultItem, Product, ServerCartItem } from '../types';
import { CartRepo } from '../repos/CartRepo';
import { useAuthStore } from './useAuthStore';

/**
 * AsyncStorage 适配器（实现 Zustand StateStorage 接口）
 * 购物车数据为非敏感数据，使用 AsyncStorage 即可
 * Web 平台回退到 localStorage
 */
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

export type CartItem = {
  productId: string;
  skuId?: string;
  categoryId?: string;
  companyId?: string;
  title: string;
  price: number;
  image: string;
  quantity: number;
  /** 每单限购数量（null 表示不限） */
  maxPerOrder?: number | null;
  /** 服务端购物车项 ID */
  id?: string;
  /** 是否为奖品 */
  isPrize?: boolean;
  /** 是否锁定（赠品门槛未达） */
  isLocked?: boolean;
  /** 过期时间 */
  expiresAt?: string;
  /** 赠品解锁门槛 */
  threshold?: number;
  /** 关联的中奖记录 ID */
  prizeRecordId?: string;
  /** 奖品类型 */
  prizeType?: string;
  /** 奖品项的 SKU 原价（用于划线展示） */
  originalPrice?: number | null;
  /** 公开抽奖中奖凭证（未登录中奖时存储，登录合并时传给后端验证） */
  claimToken?: string;
  /** 匿名中奖待登录认领 */
  pendingClaim?: boolean;
};

export type LocalCartMergeOutcome = {
  mergeErrors?: string[];
  mergeResults: CartMergeResultItem[];
};

// 复合键函数
const cartKey = (productId: string, skuId?: string) =>
  skuId ? `${productId}:${skuId}` : productId;

const itemKey = (item: CartItem) => cartKey(item.productId, item.skuId);

// 将服务端项转为本地 CartItem
const serverToLocal = (si: ServerCartItem): CartItem => ({
  id: si.id,
  productId: si.product.id,
  skuId: si.skuId,
  categoryId: si.product.categoryId ?? undefined,
  companyId: si.product.companyId ?? undefined,
  title: si.product.title,
  price: si.product.price,
  image: si.product.image || '',
  quantity: si.quantity,
  isPrize: si.isPrize,
  isLocked: si.isLocked,
  expiresAt: si.expiresAt,
  threshold: si.threshold,
  prizeRecordId: si.prizeRecordId,
  prizeType: si.prizeType,
  originalPrice: si.product.originalPrice,
  maxPerOrder: si.product.maxPerOrder ?? null,
});

type CartState = {
  items: CartItem[];
  selectedIds: Set<string>;
  loading: boolean;
  /** 从服务端同步购物车 */
  syncFromServer: () => Promise<void>;
  /** 添加商品（乐观 + 服务端），返回 true 表示成功加入，false 表示被限购拦截 */
  addItem: (product: Product & { maxPerOrder?: number | null }, quantity?: number, skuId?: string, skuPrice?: number) => boolean;
  /** 删除商品（乐观 + 服务端） */
  removeItem: (productId: string, skuId?: string) => void;
  /** 删除奖品项（乐观 + 服务端，按 cartItemId 删除） */
  removePrizeItem: (cartItemId: string) => void;
  /** 添加匿名中奖待认领奖品 */
  addPendingPrizeItem: (item: CartItem) => void;
  /** 修改数量（乐观 + 服务端） */
  updateQty: (productId: string, quantity: number, skuId?: string) => void;
  /** 清除已结算项（结算成功后调用） */
  clearCheckedItems: () => void;
  /** 清空购物车 */
  clear: () => void;
  /** 登录后将本地购物车合并到服务端，返回结构化合并结果 */
  syncLocalCartToServer: () => Promise<LocalCartMergeOutcome | undefined>;
  total: () => number;
  count: () => number;
  // 选择管理
  toggleSelect: (productId: string, skuId?: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  isAllSelected: () => boolean;
  selectedTotal: () => number;
  /** 非奖品已勾选商品总额（用于赠品解锁判断） */
  selectedNonPrizeTotal: () => number;
  selectedCount: () => number;
  selectedItems: () => CartItem[];
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      selectedIds: new Set<string>(),
      loading: false,

      syncFromServer: async () => {
        // 未登录时不从服务端同步
        if (!useAuthStore.getState().isLoggedIn) return;

        set({ loading: true });
        try {
          const result = await CartRepo.get();
          if (result.ok) {
            const serverItems = result.data.items.map(serverToLocal);
            set((state) => {
              const oldKeys = new Set(state.items.map(itemKey));
              const validKeys = new Set(serverItems.map(itemKey));
              const newSelectedIds = new Set<string>();
              // 保持已有的勾选状态
              for (const id of state.selectedIds) {
                if (validKeys.has(id)) newSelectedIds.add(id);
              }
              // 新增的商品自动选中（如抽奖奖品加入购物车）
              for (const item of serverItems) {
                const key = itemKey(item);
                if (!oldKeys.has(key)) newSelectedIds.add(key);
              }
              return { items: serverItems, selectedIds: newSelectedIds, loading: false };
            });
          }
        } catch {
          // 网络错误，保持现有数据
        } finally {
          set({ loading: false });
        }
      },

      addItem: (product, quantity = 1, skuId, skuPrice) => {
        const key = cartKey(product.id, skuId);

        // 单笔限购校验
        const maxPerOrder = product.maxPerOrder;
        if (maxPerOrder != null) {
          const existing = get().items.find((item) => itemKey(item) === key);
          const currentQty = existing?.quantity ?? 0;
          if (currentQty + Math.max(1, quantity) > maxPerOrder) {
            Toast.show({
              type: 'info',
              text1: `该商品每单限购 ${maxPerOrder} 件`,
              text2: currentQty > 0 ? `购物车已有 ${currentQty} 件` : undefined,
            });
            return false;
          }
        }

        // 乐观更新（本地模式和服务端模式都执行）
        set((state) => {
          const existing = state.items.find((item) => itemKey(item) === key);
          const newSelectedIds = new Set(state.selectedIds);
          // 加入购物车的商品自动选中
          newSelectedIds.add(key);
          if (existing) {
            return {
              items: state.items.map((item) =>
                itemKey(item) === key
                  ? { ...item, quantity: item.quantity + Math.max(1, quantity) }
                  : item
              ),
              selectedIds: newSelectedIds,
            };
          }
          return {
            items: [
              ...state.items,
              {
                productId: product.id,
                skuId,
                categoryId: product.categoryId,
                companyId: product.companyId,
                title: product.title,
                price: skuPrice ?? product.price,
                image: product.image,
                quantity: Math.max(1, quantity),
                maxPerOrder: product.maxPerOrder ?? null,
              },
            ],
            selectedIds: newSelectedIds,
          };
        });

        // 已登录时才异步服务端同步
        if (useAuthStore.getState().isLoggedIn) {
          const actualSkuId = skuId ?? product.id;
          CartRepo.addItem(actualSkuId, Math.max(1, quantity), {
            id: product.id,
            title: product.title,
            image: product.image,
            price: skuPrice ?? product.price,
          }).then((result) => {
            if (result.ok) {
              // 用服务端响应覆盖本地数据
              const serverItems = result.data.items.map(serverToLocal);
              set((state) => {
                const validKeys = new Set(serverItems.map(itemKey));
                const newSelectedIds = new Set<string>();
                for (const id of state.selectedIds) {
                  if (validKeys.has(id)) newSelectedIds.add(id);
                }
                // 确保新添加的项保持选中（通过 skuId 匹配，服务端可能返回不同的 productId）
                const addedItem = serverItems.find((si) => si.skuId === (skuId ?? product.id));
                if (addedItem) {
                  newSelectedIds.add(itemKey(addedItem));
                } else if (validKeys.has(key)) {
                  newSelectedIds.add(key);
                }
                return { items: serverItems, selectedIds: newSelectedIds };
              });
            } else {
              // 失败回滚：重新同步
              get().syncFromServer();
            }
          });
        }

        return true;
      },

      removeItem: (productId, skuId) => {
        const key = cartKey(productId, skuId);
        const snapshot = get().items;

        // 乐观删除
        set((state) => {
          const newSelectedIds = new Set(state.selectedIds);
          newSelectedIds.delete(key);
          return {
            items: state.items.filter((item) => itemKey(item) !== key),
            selectedIds: newSelectedIds,
          };
        });

        // 已登录时才异步服务端同步
        if (useAuthStore.getState().isLoggedIn) {
          const actualSkuId = skuId ?? productId;
          CartRepo.removeItem(actualSkuId).then((result) => {
            if (!result.ok) {
              // 回滚
              set({ items: snapshot });
            }
          });
        }
      },

      removePrizeItem: (cartItemId: string) => {
        const snapshot = get().items;
        const targetItem = snapshot.find((item) => item.id === cartItemId);

        // 乐观删除
        set((state) => {
          const newItems = state.items.filter((item) => item.id !== cartItemId);
          const newSelectedIds = new Set(state.selectedIds);
          if (targetItem) {
            const key = itemKey(targetItem);
            newSelectedIds.delete(key);
          }
          return { items: newItems, selectedIds: newSelectedIds };
        });

        // 已登录时才异步服务端同步
        if (useAuthStore.getState().isLoggedIn) {
          CartRepo.removePrizeItem(cartItemId).then((result) => {
            if (result.ok) {
              // 用服务端响应覆盖本地数据
              const serverItems = result.data.items.map(serverToLocal);
              set((state) => {
                const validKeys = new Set(serverItems.map(itemKey));
                const newSelectedIds = new Set<string>();
                for (const id of state.selectedIds) {
                  if (validKeys.has(id)) newSelectedIds.add(id);
                }
                return { items: serverItems, selectedIds: newSelectedIds };
              });
            } else {
              // 回滚
              set({ items: snapshot });
            }
          });
        }
      },

      addPendingPrizeItem: (item) => {
        const key = itemKey(item);
        set((state) => {
          if (item.claimToken && state.items.some((existing) => existing.claimToken === item.claimToken)) {
            return state;
          }
          const newSelectedIds = new Set(state.selectedIds);
          newSelectedIds.add(key);
          return {
            items: [...state.items, item],
            selectedIds: newSelectedIds,
          };
        });
      },

      updateQty: (productId, quantity, skuId) => {
        const key = cartKey(productId, skuId);

        if (quantity <= 0) {
          get().removeItem(productId, skuId);
          return;
        }

        // 单笔限购校验：超出限购数量时截断到上限，而非直接拒绝
        const item = get().items.find((i) => itemKey(i) === key);
        let clampedQty = quantity;
        if (item?.maxPerOrder != null && clampedQty > item.maxPerOrder) {
          clampedQty = item.maxPerOrder;
          Toast.show({
            type: 'info',
            text1: `该商品每单限购 ${item.maxPerOrder} 件`,
          });
        }

        const snapshot = get().items;

        // 乐观更新
        set((state) => ({
          items: state.items.map((item) =>
            itemKey(item) === key ? { ...item, quantity: clampedQty } : item
          ),
        }));

        // 已登录时才异步服务端同步
        if (useAuthStore.getState().isLoggedIn) {
          const actualSkuId = skuId ?? productId;
          CartRepo.updateQuantity(actualSkuId, clampedQty).then((result) => {
            if (!result.ok) {
              set({ items: snapshot });
            }
          });
        }
      },

      clearCheckedItems: () => {
        const { items, selectedIds } = get();
        const remaining = items.filter((item) => !selectedIds.has(itemKey(item)));
        set({ items: remaining, selectedIds: new Set<string>() });
      },

      clear: () => {
        // 乐观清空（锁定赠品保留，后端也不会删除锁定赠品）
        set((state) => {
          const lockedItems = state.items.filter((item) => item.isLocked);
          return { items: lockedItems, selectedIds: new Set<string>() };
        });

        // 已登录时才异步服务端同步
        if (useAuthStore.getState().isLoggedIn) {
          CartRepo.clear().then(() => {
            get().syncFromServer();
          });
        }
      },

      syncLocalCartToServer: async () => {
        const { items } = get();
        if (items.length === 0) {
          // 没有本地项要合并，但仍需从服务端同步
          await get().syncFromServer();
          return undefined;
        }
        const mergePayload = items.map((item) => ({
          localKey: itemKey(item),
          skuId: item.skuId ?? item.productId,
          quantity: item.quantity,
          isPrize: item.isPrize,
          // HC-1: 奖品项只传 claimToken，后端从 Redis + DB 反查元数据
          claimToken: item.isPrize ? item.claimToken : undefined,
        }));
        const result = await CartRepo.mergeItems(mergePayload);
        if (result.ok) {
          const serverItems = result.data.items.map(serverToLocal);
          set({ items: serverItems, selectedIds: new Set(serverItems.map(itemKey)) });
          return {
            mergeErrors: result.data.mergeErrors,
            mergeResults: result.data.mergeResults ?? [],
          };
        } else {
          // 合并失败时仍从服务端同步，确保数据一致
          await get().syncFromServer();
          return undefined;
        }
      },

      total: () => get().items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      count: () => get().items.reduce((sum, item) => sum + item.quantity, 0),

      toggleSelect: (productId, skuId) => {
        set((state) => {
          const key = cartKey(productId, skuId);
          const newSelectedIds = new Set(state.selectedIds);
          if (newSelectedIds.has(key)) {
            newSelectedIds.delete(key);
          } else {
            newSelectedIds.add(key);
          }
          return { selectedIds: newSelectedIds };
        });
      },

      selectAll: () => {
        set((state) => ({
          selectedIds: new Set(state.items.map(itemKey)),
        }));
      },

      deselectAll: () => {
        set({ selectedIds: new Set<string>() });
      },

      isAllSelected: () => {
        const { items, selectedIds } = get();
        return items.length > 0 && items.every((item) => selectedIds.has(itemKey(item)));
      },

      selectedTotal: () => {
        const { items, selectedIds } = get();
        return items
          .filter((item) => selectedIds.has(itemKey(item)))
          .reduce((sum, item) => sum + item.price * item.quantity, 0);
      },

      selectedNonPrizeTotal: () => {
        const { items, selectedIds } = get();
        return items
          .filter((item) => selectedIds.has(itemKey(item)) && !item.isPrize)
          .reduce((sum, item) => sum + item.price * item.quantity, 0);
      },

      selectedCount: () => {
        const { items, selectedIds } = get();
        return items.filter((item) => selectedIds.has(itemKey(item))).length;
      },

      selectedItems: () => {
        const { items, selectedIds } = get();
        return items.filter((item) => selectedIds.has(itemKey(item)));
      },
    }),
    {
      name: 'nongmai-cart',
      storage: createJSONStorage(() => cartStorage),
      // 只持久化数据字段，不持久化方法和 loading 状态
      partialize: (state) => ({
        items: state.items,
        selectedIds: Array.from(state.selectedIds), // Set 无法直接序列化
      }),
      // 反序列化时将 selectedIds 数组还原为 Set
      merge: (persisted: any, current: CartState) => ({
        ...current,
        ...(persisted ?? {}),
        selectedIds: new Set<string>(persisted?.selectedIds ?? []),
      }),
    },
  ),
);
