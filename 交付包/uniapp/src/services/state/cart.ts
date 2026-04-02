// 购物车本地状态（前端占位 + 后端对接接口说明）
//
// 目标：
// - 让“🛒角标”在首页/我的等页面实时联动
// - 让购物车页的数量编辑能立即反映到角标与总价
//
// 后端对接建议：
// - 登录后，CartState 的实现可改为调用后端购物车接口（或在每次变更后同步一次）
// - 推荐后端提供：GET /cart、POST /cart/items、PATCH /cart/items/:id、DELETE /cart/items/:id
// - 前端保持这里的方法签名不变，后端同事只需在 Repo/State 内替换实现即可
import { APP_EVENTS } from './events';
import { emitAppEvent } from './uniEvents';

export type CartItem = {
  productId: string;
  title: string;
  price: number;
  image?: string;
  qty: number;
};

export type CartSnapshot = {
  items: CartItem[];
  count: number; // 商品件数合计（qty 求和）
  total: number; // 总价
};

const STORAGE_KEY = 'nm_cart_items_v1';

const safeParse = (raw: unknown): CartItem[] => {
  try {
    if (typeof raw !== 'string') return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => ({
        productId: String((x as any).productId ?? ''),
        title: String((x as any).title ?? ''),
        price: Number((x as any).price ?? 0),
        image: (x as any).image ? String((x as any).image) : undefined,
        qty: Math.max(0, Number((x as any).qty ?? 0)),
      }))
      .filter((x) => x.productId && x.qty > 0);
  } catch {
    return [];
  }
};

const loadItems = (): CartItem[] => {
  const raw = uni.getStorageSync(STORAGE_KEY);
  return safeParse(raw);
};

const saveItems = (items: CartItem[]) => {
  uni.setStorageSync(STORAGE_KEY, JSON.stringify(items));
};

const calcSnapshot = (items: CartItem[]): CartSnapshot => {
  const count = items.reduce((sum, it) => sum + it.qty, 0);
  const total = items.reduce((sum, it) => sum + it.qty * it.price, 0);
  return { items, count, total };
};

const notify = (items: CartItem[]) => {
  emitAppEvent(APP_EVENTS.CART_CHANGED, calcSnapshot(items));
};

export const CartState = {
  getSnapshot(): CartSnapshot {
    const items = loadItems();
    return calcSnapshot(items);
  },

  addProduct(payload: { id: string; title: string; price: string | number; image?: string }, qty = 1) {
    const addQty = Math.max(1, Number(qty || 1));
    const items = loadItems();
    const index = items.findIndex((x) => x.productId === payload.id);
    const price = Number(payload.price);
    if (index >= 0) {
      items[index].qty += addQty;
    } else {
      items.push({
        productId: payload.id,
        title: payload.title,
        price: Number.isFinite(price) ? price : 0,
        image: payload.image,
        qty: addQty,
      });
    }
    saveItems(items);
    notify(items);
  },

  setQty(productId: string, qty: number) {
    const nextQty = Math.max(0, Math.floor(Number(qty || 0)));
    const items = loadItems();
    const index = items.findIndex((x) => x.productId === productId);
    if (index < 0) return;
    if (nextQty <= 0) {
      items.splice(index, 1);
    } else {
      items[index].qty = nextQty;
    }
    saveItems(items);
    notify(items);
  },

  remove(productId: string) {
    const items = loadItems().filter((x) => x.productId !== productId);
    saveItems(items);
    notify(items);
  },

  clear() {
    saveItems([]);
    notify([]);
  },
};

