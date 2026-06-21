import client from './client';

export interface DeliverySellerDashboardSummary {
  pendingShipmentCount?: number;
  deliveredPendingSettlementCount?: number;
}

export const getDashboard = (): Promise<DeliverySellerDashboardSummary> =>
  client.get('/delivery-seller/dashboard');
