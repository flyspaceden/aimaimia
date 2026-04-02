/**
 * 购物车状态（Store）
 *
 * 当前实现：
 * - 纯前端本地状态（zustand），用于演示“加购/数量修改/角标/结算”
 *
 * 后端接入说明（可选）：
 * - 方案 A（当前推荐）：购物车仍由前端维护，结算时把 items 作为 `OrderRepo.createFromCart` 的入参提交到后端创建订单
 * - 方案 B（需要账号体系）：购物车由后端维护（跨端同步/多设备），则需要接口：
 *   - `GET /api/v1/cart`
 *   - `POST /api/v1/cart/items` / `PATCH /api/v1/cart/items/{productId}` / `DELETE /api/v1/cart/items/{productId}`
 *
 * 说明：
 * - 无论采用哪种方案，支付/订单状态机都应该由后端控制
 */
import { create } from 'zustand';
import { Product } from '../types';

export type CartItem = {
  productId: string;
  title: string;
  price: number;
  image: string;
  quantity: number;
};

type CartState = {
  items: CartItem[];
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, quantity: number) => void;
  clear: () => void;
  total: () => number;
  count: () => number;
};

// 购物车状态：用于加购、数量修改、角标统计
export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  addItem: (product, quantity = 1) => {
    set((state) => {
      const nextQty = Math.max(1, quantity);
      const existing = state.items.find((item) => item.productId === product.id);

      if (existing) {
        return {
          items: state.items.map((item) =>
            item.productId === product.id
              ? { ...item, quantity: item.quantity + nextQty }
              : item
          ),
        };
      }

      return {
        items: [
          ...state.items,
          {
            productId: product.id,
            title: product.title,
            price: product.price,
            image: product.image,
            quantity: nextQty,
          },
        ],
      };
    });
  },
  removeItem: (productId) => {
    set((state) => ({
      items: state.items.filter((item) => item.productId !== productId),
    }));
  },
  updateQty: (productId, quantity) => {
    set((state) => {
      if (quantity <= 0) {
        return { items: state.items.filter((item) => item.productId !== productId) };
      }

      return {
        items: state.items.map((item) =>
          item.productId === productId ? { ...item, quantity } : item
        ),
      };
    });
  },
  clear: () => set({ items: [] }),
  total: () => get().items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  count: () => get().items.reduce((sum, item) => sum + item.quantity, 0),
}));
