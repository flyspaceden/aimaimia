import client from './client';

export interface DeliveryManifest {
  id: string;
  merchantId?: string | null;
  templateId?: string | null;
  templateVersionId?: string | null;
  type: string;
  format: string;
  status: string;
  title: string;
  fileUrl: string;
  storageKey?: string | null;
  generatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const exportFulfillmentManifest = (subOrderId: string): Promise<DeliveryManifest> =>
  client.get(`/delivery-seller/orders/${subOrderId}/fulfillment-manifest`);

export const exportFinanceManifest = (): Promise<DeliveryManifest> =>
  client.get('/delivery-seller/finance/export');
