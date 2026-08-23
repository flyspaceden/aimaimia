export type TrackingEvent = {
  id: string;
  occurredAt: string;
  message: string;
  location?: string;
  statusCode?: string;
  shipmentId?: string;
  carrierName?: string;
  trackingNo?: string | null;
};

export type Shipment = {
  id: string;
  companyId?: string | null;
  carrierCode: string;
  carrierName: string;
  trackingNo: string | null;
  trackingNoMasked?: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  events: TrackingEvent[];
};

export type ShipmentDetail = Shipment & { shipments: Shipment[] };
