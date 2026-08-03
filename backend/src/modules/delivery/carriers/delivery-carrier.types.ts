import { DeliveryPickupBatchStatus } from '../../../generated/delivery-client';

export type DeliveryCarrierParty = {
  name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
};

export type DeliveryCarrierCargo = {
  name: string;
  quantity: number;
  weightKg: number;
  remark?: string;
};

export type DeliverySfCreateShipmentRequest = {
  outsideOrderId: string;
  sender: DeliveryCarrierParty;
  receiver: DeliveryCarrierParty;
  cargo: DeliveryCarrierCargo;
  expressTypeId: number;
  expressTypeName: string;
  packageCount: number;
  totalWeightKg: number;
};

export type DeliverySfCreateShipmentResult = {
  provider: 'SF';
  outsideOrderId: string;
  sfOrderId: string;
  primaryWaybillNo: string;
  waybillNos: string[];
  waybillUrl: string | null;
  status: DeliveryPickupBatchStatus;
  rawPayload: unknown;
};

export type DeliverySfWaybillDetail = {
  trackingNo: string;
  status: string;
  mappedStatus: DeliveryPickupBatchStatus;
  events: unknown[];
};

export type DeliverySfSyncResult = {
  provider: 'SF';
  status: DeliveryPickupBatchStatus;
  waybills: DeliverySfWaybillDetail[];
  rawPayload: unknown;
};

export type DeliverySfCancelResult = {
  provider: 'SF';
  success: boolean;
  status: 'CANCELED';
  rawPayload: unknown;
};
