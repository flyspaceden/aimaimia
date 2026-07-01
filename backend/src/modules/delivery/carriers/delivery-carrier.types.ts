import { DeliveryPickupBatchStatus } from '../../../generated/delivery-client';

export type DeliveryCarrierParty = {
  name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  lat?: number;
  lng?: number;
};

export type DeliveryCarrierCargo = {
  name: string;
  quantity: number;
  weightKg: number;
  remark?: string;
};

export type DeliveryCarrierQuoteRequest = {
  outsideOrderId: string;
  cityId: string;
  vehicleId: string;
  sender: DeliveryCarrierParty;
  receiver: DeliveryCarrierParty;
  cargo: DeliveryCarrierCargo;
  plannedPickupAt?: Date;
};

export type DeliveryCarrierQuoteResult = {
  provider: 'HUOLALA';
  priceCalculateId: string;
  estimatedFeeCents: number;
  rawPayload: unknown;
};

export type DeliveryCarrierOrderResult = {
  provider: 'HUOLALA';
  outsideOrderId: string;
  carrierOrderNo: string;
  status: string;
  rawPayload: unknown;
};

export type DeliveryCarrierDetailResult = {
  provider: 'HUOLALA';
  outsideOrderId?: string;
  carrierOrderNo: string;
  status: string;
  mappedStatus: DeliveryPickupBatchStatus;
  estimatedFeeCents?: number;
  actualFeeCents?: number;
  driverSnapshot?: unknown;
  vehicleSnapshot?: unknown;
  rawPayload: unknown;
};

export type DeliveryCarrierCancelResult = {
  provider: 'HUOLALA';
  carrierOrderNo: string;
  status: string;
  rawPayload: unknown;
};
