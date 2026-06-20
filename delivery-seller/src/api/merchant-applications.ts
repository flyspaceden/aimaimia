import client from './client';

export type CreateDeliveryMerchantApplicationInput = {
  companyName: string;
  contactName: string;
  contactPhone: string;
  email?: string;
  note?: string;
};

export const createDeliveryMerchantApplication = (
  data: CreateDeliveryMerchantApplicationInput,
): Promise<{ message: string }> =>
  client.post('/delivery-seller/merchant-applications', data);
