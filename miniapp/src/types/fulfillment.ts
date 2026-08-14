export type FulfillmentMode = 'DELIVERY' | 'PICKUP';

export type PickupFulfillmentStatus =
  | 'PREPARING'
  | 'READY'
  | 'PICKED_UP'
  | 'VOID'
  | 'CANCELED';

export type PickupPointLocation = {
  lng: number;
  lat: number;
  provider?: string;
  poiName?: string;
};

export type PickupPoint = {
  id: string;
  companyId: string;
  name: string;
  contactName: string;
  contactPhoneMasked: string;
  regionText: string;
  detail: string;
  location?: PickupPointLocation | null;
  businessHours: unknown;
  pickupNotice?: string | null;
};

export type PickupPointGroup = {
  companyId: string;
  companyName: string;
  points: PickupPoint[];
};

export type DeliveryFulfillmentInput = {
  mode: 'DELIVERY';
  addressId: string;
};

export type PickupFulfillmentInput = {
  mode: 'PICKUP';
  recipientName: string;
  recipientPhone: string;
  selections: Array<{ companyId: string; pickupPointId: string }>;
};

export type FulfillmentInput = DeliveryFulfillmentInput | PickupFulfillmentInput;

export type CheckoutFulfillmentSummary = {
  mode: FulfillmentMode;
  merchantGroups: Array<{
    companyId: string;
    companyName?: string;
    pickupPoints: PickupPoint[];
  }>;
};

export type PickupFulfillmentSummary = {
  status: PickupFulfillmentStatus;
  pickupPoint: Pick<
    PickupPoint,
    'name' | 'regionText' | 'detail' | 'location' | 'businessHours' | 'pickupNotice'
  >;
  recipient: { name: string; phoneMasked: string };
  readyAt?: string | null;
  pickedUpAt?: string | null;
};

export type PickupPass = {
  orderId: string;
  status: 'READY';
  pickupCode: string;
  qrPayload: string;
  expiresAt: string;
  pickupPoint: PickupFulfillmentSummary['pickupPoint'];
  recipient: PickupFulfillmentSummary['recipient'];
};
