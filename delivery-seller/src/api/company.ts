import client from './client';
import type {
  Company,
  CompanyStaff,
  CreateCompanyStaffPayload,
  UpdateCompanyPayload,
  UpdateCompanyStaffPayload,
} from '@/types';

export const getCompany = (): Promise<Company> =>
  client.get('/delivery-seller/company');

export const updateCompany = (data: UpdateCompanyPayload): Promise<Company> =>
  client.patch('/delivery-seller/company', data);

export const getStaff = (): Promise<CompanyStaff[]> =>
  client.get('/delivery-seller/staff');

export const createStaff = (data: CreateCompanyStaffPayload): Promise<CompanyStaff> =>
  client.post('/delivery-seller/staff', data);

export const updateStaff = (id: string, data: UpdateCompanyStaffPayload): Promise<CompanyStaff> =>
  client.patch(`/delivery-seller/staff/${id}`, data);
