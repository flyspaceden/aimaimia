import { RepurchaseResult } from '../types';

type ToastType = 'success' | 'info';

export function formatRepurchaseToast(result: RepurchaseResult): { message: string; type: ToastType } {
  const priceSuffix = result.priceChangedCount > 0 ? '，部分商品价格已变动，请到购物车确认' : '';
  const virtualCount = result.items.filter((item) => item.virtual || item.reason === 'OUT_OF_STOCK_VIRTUAL').length;
  if (virtualCount > 0 && result.addedQuantity === 0) {
    return { message: '商品暂无库存，未加入购物车', type: 'info' };
  }
  if (virtualCount > 0) {
    return {
      message: `已加入 ${result.addedQuantity} 件商品，${virtualCount} 个商品暂无库存${priceSuffix}`,
      type: 'info',
    };
  }
  if (result.skippedQuantity > 0) {
    return {
      message: `已加入 ${result.addedQuantity} 件商品，${result.skippedQuantity} 件不可购买${priceSuffix}`,
      type: 'info',
    };
  }

  return {
    message: `已加入购物车${priceSuffix}`,
    type: result.priceChangedCount > 0 ? 'info' : 'success',
  };
}
