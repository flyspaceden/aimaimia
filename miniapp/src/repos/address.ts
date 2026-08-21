import { ApiClient } from '@/api/client';
import type {
  Address,
  AddressInput,
  Result,
  UpdateAddressInput,
} from '@/types';

export const AddressRepo = {
  list: (): Promise<Result<Address[]>> => ApiClient.get<Address[]>('/addresses'),

  create: (input: AddressInput): Promise<Result<Address>> =>
    ApiClient.post<Address>('/addresses', input),

  update: (addressId: string, input: UpdateAddressInput): Promise<Result<Address>> =>
    ApiClient.put<Address>(`/addresses/${addressId}`, input),

  remove: (addressId: string): Promise<Result<void>> =>
    ApiClient.delete<void>(`/addresses/${addressId}`),

  setDefault: (addressId: string): Promise<Result<Address>> =>
    ApiClient.put<Address>(`/addresses/${addressId}/default`),
};
