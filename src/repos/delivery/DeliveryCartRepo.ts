import { Result } from '../../types';
import {
  buildDeliveryPath,
  centsToYuan,
  deliveryApiClient,
  mapDeliveryResult,
} from './DeliveryAuthRepo';
import type { DeliveryCatalogMerchant } from './DeliveryProductRepo';

type DeliveryCartItemResponse = {
  id: string;
  skuId: string;
  quantity: number;
  isSelected: boolean;
  productId: string;
  productTitle: string;
  skuTitle: string;
  imageUrl: string | null;
  unitName: string;
  merchant: DeliveryCatalogMerchant;
  stock: number;
  minOrderQuantity: number;
  orderStepQuantity: number;
  finalPriceCents: number;
  lineAmountCents: number;
  pricingSource?: string | null;
};

type DeliveryCartResponse = {
  currentUnitId: string;
  items: DeliveryCartItemResponse[];
  summary: {
    selectedGoodsAmountCents: number;
  };
};

export type DeliveryCartItem = {
  id: string;
  skuId: string;
  quantity: number;
  isSelected: boolean;
  productId: string;
  productTitle: string;
  skuTitle: string;
  imageUrl: string;
  unitName: string;
  merchant: DeliveryCatalogMerchant;
  stock: number;
  minOrderQuantity: number;
  orderStepQuantity: number;
  finalPrice: number;
  lineAmount: number;
  pricingSource?: string | null;
};

export type DeliveryCart = {
  currentUnitId: string;
  items: DeliveryCartItem[];
  summary: {
    selectedGoodsAmount: number;
  };
};

export const deliveryCartPaths = {
  list: () => buildDeliveryPath('cart'),
  items: () => buildDeliveryPath('cart/items'),
  item: (id: string) => buildDeliveryPath(`cart/items/${id}`),
};

export const mapDeliveryCartResponse = (payload: DeliveryCartResponse): DeliveryCart => ({
  currentUnitId: payload.currentUnitId,
  items: payload.items.map((item) => ({
    id: item.id,
    skuId: item.skuId,
    quantity: item.quantity,
    isSelected: item.isSelected,
    productId: item.productId,
    productTitle: item.productTitle,
    skuTitle: item.skuTitle,
    imageUrl: item.imageUrl ?? '',
    unitName: item.unitName,
    merchant: item.merchant,
    stock: item.stock,
    minOrderQuantity: item.minOrderQuantity,
    orderStepQuantity: item.orderStepQuantity,
    finalPrice: centsToYuan(item.finalPriceCents),
    lineAmount: centsToYuan(item.lineAmountCents),
    pricingSource: item.pricingSource ?? null,
  })),
  summary: {
    selectedGoodsAmount: centsToYuan(payload.summary.selectedGoodsAmountCents),
  },
});

export const DeliveryCartRepo = {
  getCart: (): Promise<Result<DeliveryCart>> =>
    deliveryApiClient
      .get<DeliveryCartResponse>(deliveryCartPaths.list())
      .then((result) => mapDeliveryResult(result, mapDeliveryCartResponse)),

  addItem: (payload: { skuId: string; quantity: number }): Promise<Result<{ item: { id: string; skuId: string; quantity: number } }>> =>
    deliveryApiClient.post<{ item: { id: string; skuId: string; quantity: number } }>(deliveryCartPaths.items(), payload),

  updateItem: (
    id: string,
    payload: { quantity?: number; isSelected?: boolean },
  ): Promise<Result<{ item: { id: string; skuId: string; quantity: number; isSelected: boolean } }>> =>
    deliveryApiClient.patch<{ item: { id: string; skuId: string; quantity: number; isSelected: boolean } }>(
      deliveryCartPaths.item(id),
      payload,
    ),

  removeItem: (id: string): Promise<Result<{ removedId: string }>> =>
    deliveryApiClient.delete<{ removedId: string }>(deliveryCartPaths.item(id)),
};
