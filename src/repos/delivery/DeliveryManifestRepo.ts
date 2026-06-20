import { Result } from '../../types';
import { buildDeliveryPath, deliveryApiClient, mapDeliveryResult } from './DeliveryAuthRepo';

export type DeliveryManifest = {
  id: string;
  type: string;
  format: string;
  title: string;
  fileUrl: string;
  storageKey: string;
  status: string;
  generatedAt: string;
  payloadSnapshot?: Record<string, unknown>;
  templateVersion: {
    id: string | null;
    versionNo: number | null;
  };
};

type DeliveryManifestResponse = {
  id: string;
  type: string;
  format: string;
  title: string;
  fileUrl: string;
  storageKey: string;
  status: string;
  generatedAt: string;
  payloadSnapshot?: Record<string, unknown>;
  templateVersion: {
    id: string | null;
    versionNo: number | null;
  };
};

export const deliveryManifestPaths = {
  list: () => buildDeliveryPath('manifests'),
  order: (orderId: string) => buildDeliveryPath(`orders/${orderId}/manifest`),
};

export const mapDeliveryManifestRow = (
  manifest: DeliveryManifestResponse,
): DeliveryManifest => ({
  id: manifest.id,
  type: manifest.type,
  format: manifest.format,
  title: manifest.title,
  fileUrl: manifest.fileUrl,
  storageKey: manifest.storageKey,
  status: manifest.status,
  generatedAt: manifest.generatedAt,
  payloadSnapshot: manifest.payloadSnapshot,
  templateVersion: {
    id: manifest.templateVersion.id,
    versionNo: manifest.templateVersion.versionNo,
  },
});

export const DeliveryManifestRepo = {
  list: (): Promise<Result<DeliveryManifest[]>> =>
    deliveryApiClient
      .get<DeliveryManifestResponse[]>(deliveryManifestPaths.list())
      .then((result) => mapDeliveryResult(result, (items) => items.map(mapDeliveryManifestRow))),

  getOrderManifest: (orderId: string): Promise<Result<DeliveryManifest>> =>
    deliveryApiClient
      .get<DeliveryManifestResponse>(deliveryManifestPaths.order(orderId))
      .then((result) => mapDeliveryResult(result, mapDeliveryManifestRow)),
};
