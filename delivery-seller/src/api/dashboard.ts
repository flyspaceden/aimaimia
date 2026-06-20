import client from './client';

export interface DeliverySellerDashboardSummary {
  pendingShipmentCount?: number;
  deliveredPendingSettlementCount?: number;
  openConversationCount?: number;
}

export const getDashboard = (): Promise<DeliverySellerDashboardSummary> =>
  client.get('/delivery-seller/dashboard');
