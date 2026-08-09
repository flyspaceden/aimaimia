export type Address = {
  id: string;
  receiverName: string;
  phone: string;
  regionCode?: string;
  regionText?: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  isDefault: boolean;
  createdAt: string;
};

export type AddressInput = {
  receiverName: string;
  phone: string;
  regionCode: string;
  regionText: string;
  detail: string;
  isDefault?: boolean;
};

export type UpdateAddressInput = Partial<Omit<AddressInput, 'isDefault'>>;
