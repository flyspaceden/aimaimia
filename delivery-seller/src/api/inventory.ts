import client from './client';

export interface UpdateSkuStockPayload {
  stock: number;
  remark?: string;
}

export interface UpdateSkuStockResult {
  sku: {
    id: string;
    stock: number;
    updatedAt: string;
  };
  ledger: {
    id: string;
    skuId: string;
    quantity: number;
    beforeStock: number;
    afterStock: number;
    createdAt: string;
  };
}

export const updateSkuStock = (
  skuId: string,
  data: UpdateSkuStockPayload,
): Promise<UpdateSkuStockResult> =>
  client.patch(`/delivery-seller/skus/${skuId}/stock`, data);
