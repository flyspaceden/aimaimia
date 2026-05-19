declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import { formatRepurchaseToast } from '../repurchaseToast';
import type { RepurchaseResult } from '../../types/domain/Order';

function baseResult(overrides: Partial<RepurchaseResult> = {}): RepurchaseResult {
  return {
    addedItemCount: 0,
    addedQuantity: 0,
    skippedItemCount: 0,
    skippedQuantity: 0,
    priceChangedCount: 0,
    cart: { id: 'c1', items: [] } as any,
    items: [],
    ...overrides,
  };
}

describe('formatRepurchaseToast virtual stock branches', () => {
  it('reports out-of-stock-only message when addedQuantity is 0 but virtual notices exist', () => {
    const toast = formatRepurchaseToast(baseResult({
      skippedItemCount: 1,
      skippedQuantity: 3,
      items: [
        {
          orderItemId: 'oi1',
          skuId: 'sku1',
          title: '龙虾',
          quantity: 3,
          status: 'SKIPPED',
          reason: 'OUT_OF_STOCK_VIRTUAL',
          virtual: true,
        } as any,
      ],
    }));
    expect(toast.message).toContain('暂无库存');
  });

  it('combines added count with virtual count when both happen', () => {
    const toast = formatRepurchaseToast(baseResult({
      addedItemCount: 1,
      addedQuantity: 1,
      skippedItemCount: 1,
      skippedQuantity: 2,
      items: [
        {
          orderItemId: 'oi1',
          skuId: 'sku1',
          title: '龙虾',
          quantity: 1,
          status: 'ADDED',
          stockStatus: 'NORMAL',
        } as any,
        {
          orderItemId: 'oi2',
          skuId: 'sku2',
          title: '橙子',
          quantity: 2,
          status: 'SKIPPED',
          reason: 'OUT_OF_STOCK_VIRTUAL',
          virtual: true,
        } as any,
      ],
    }));
    expect(toast.message).toMatch(/已加入 1 件商品/);
    expect(toast.message).toMatch(/1 个商品暂无库存/);
  });
});
