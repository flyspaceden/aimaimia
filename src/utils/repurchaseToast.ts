import { RepurchaseResult } from '../types';

type ToastType = 'success' | 'info';

export function formatRepurchaseToast(result: RepurchaseResult): { message: string; type: ToastType } {
  const priceSuffix = result.priceChangedCount > 0 ? '，部分商品价格已变动，请到购物车确认' : '';
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
