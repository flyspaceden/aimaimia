import { Result } from '../../types';
import {
  buildDeliveryPath,
  deliveryApiClient,
  DeliveryUnit,
  mapDeliveryResult,
  mapDeliveryUnit,
} from './DeliveryAuthRepo';

type DeliveryUnitResponse = {
  id: string;
  name: string;
  contactName: string;
  contactPhone: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  districtCode: string;
  districtName: string;
  detailAddress: string;
  extraFields?: Record<string, unknown> | null;
  status: string;
};

type DeliveryUnitListResponse = {
  currentUnitId: string | null;
  items: DeliveryUnitResponse[];
};

type DeliveryUnitMutationResponse = {
  unit: DeliveryUnitResponse;
  currentUnitId?: string | null;
  requiresUnit?: boolean;
};

export type DeliveryUnitList = {
  currentUnitId: string | null;
  items: DeliveryUnit[];
};

export type DeliveryUnitMutation = {
  unit: DeliveryUnit;
  currentUnitId?: string | null;
  requiresUnit?: boolean;
};

export type DeliveryUnitPayload = {
  name: string;
  contactName: string;
  contactPhone: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
  districtCode: string;
  districtName: string;
  detailAddress: string;
  extraFields?: Record<string, unknown>;
};

export const deliveryUnitPaths = {
  list: () => buildDeliveryPath('units'),
  update: (id: string) => buildDeliveryPath(`units/${id}`),
  select: (id: string) => buildDeliveryPath(`units/${id}/select`),
};

const mapDeliveryUnitList = (payload: DeliveryUnitListResponse): DeliveryUnitList => ({
  currentUnitId: payload.currentUnitId,
  items: payload.items.map(mapDeliveryUnit),
});

const mapDeliveryUnitMutation = (payload: DeliveryUnitMutationResponse): DeliveryUnitMutation => ({
  unit: mapDeliveryUnit(payload.unit),
  currentUnitId: payload.currentUnitId,
  requiresUnit: payload.requiresUnit,
});

export const DeliveryUnitRepo = {
  list: (): Promise<Result<DeliveryUnitList>> =>
    deliveryApiClient
      .get<DeliveryUnitListResponse>(deliveryUnitPaths.list())
      .then((result) => mapDeliveryResult(result, mapDeliveryUnitList)),

  create: (payload: DeliveryUnitPayload): Promise<Result<DeliveryUnitMutation>> =>
    deliveryApiClient
      .post<DeliveryUnitMutationResponse>(deliveryUnitPaths.list(), payload)
      .then((result) => mapDeliveryResult(result, mapDeliveryUnitMutation)),

  update: (id: string, payload: Partial<DeliveryUnitPayload>): Promise<Result<DeliveryUnitMutation>> =>
    deliveryApiClient
      .patch<DeliveryUnitMutationResponse>(deliveryUnitPaths.update(id), payload)
      .then((result) => mapDeliveryResult(result, mapDeliveryUnitMutation)),

  select: (id: string): Promise<Result<{ currentUnitId: string; requiresUnit: boolean }>> =>
    deliveryApiClient.post<{ currentUnitId: string; requiresUnit: boolean }>(deliveryUnitPaths.select(id)),
};
