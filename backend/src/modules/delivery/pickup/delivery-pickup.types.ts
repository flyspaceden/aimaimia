import { DeliveryPickupMode, Prisma } from '../../../generated/delivery-client';

export type CheckoutCartItemForPickup = {
  cartItemId: string;
  merchantId: string;
  merchantName?: string;
  quantity: number;
  weightGram?: number;
  lineAmountCents: number;
};

export type DeliveryPickupPlanItemInput = {
  cartItemId: string;
  batchNo: number;
  quantity: number;
};

export type DeliveryPickupBatchItemPlanSnapshot = {
  cartItemId: string;
  quantity: number;
};

export type DeliveryPickupMerchantBatchSnapshot = {
  batchNo: number;
  estimatedShippingFeeCents: number;
  items: DeliveryPickupBatchItemPlanSnapshot[];
};

export type DeliveryPickupMerchantGroupSnapshot = {
  merchantId: string;
  merchantName?: string;
  goodsAmountCents: number;
  batches: DeliveryPickupMerchantBatchSnapshot[];
};

export type DeliveryPickupPlanSnapshot = {
  pickupMode: DeliveryPickupMode;
  plannedPickupCount: number;
  fallbackShippingFeeCents: number;
  prepaidPickupShippingFeeCents: number;
  merchantGroups: DeliveryPickupMerchantGroupSnapshot[];
  perBatchEstimates: Array<{
    merchantId: string;
    batchNo: number;
    estimatedShippingFeeCents: number;
  }>;
};

export type DeliveryPickupSnapshotResult = {
  pickupMode: DeliveryPickupMode;
  plannedPickupCount: number;
  pickupPlanSnapshot: Prisma.InputJsonValue;
  prepaidPickupShippingFeeCents: number;
  perBatchEstimates: Array<{
    merchantId: string;
    batchNo: number;
    estimatedShippingFeeCents: number;
  }>;
};
