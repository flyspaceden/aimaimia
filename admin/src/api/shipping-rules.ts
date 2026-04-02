import client from './client';
import type { PaginatedData, PaginationParams } from '@/types';

export interface ShippingRule {
  id: string;
  name: string;
  regionCodes: string[];
  minAmount?: number | null;
  maxAmount?: number | null;
  minWeight?: number | null;
  maxWeight?: number | null;
  fee: number;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingPreview {
  fee: number;
  input: {
    goodsAmount: number;
    regionCode?: string;
    totalWeight?: number;
  };
}

export const getShippingRules = (params?: PaginationParams): Promise<PaginatedData<ShippingRule>> =>
  client.get('/admin/shipping-rules', { params });

export interface CreateShippingRuleInput {
  name: string;
  regionCodes?: string[];
  minAmount?: number;
  maxAmount?: number;
  minWeight?: number;
  maxWeight?: number;
  fee: number;
  priority?: number;
}

export interface UpdateShippingRuleInput extends Partial<CreateShippingRuleInput> {
  isActive?: boolean;
}

export const createShippingRule = (data: CreateShippingRuleInput): Promise<ShippingRule> =>
  client.post('/admin/shipping-rules', data);

export const updateShippingRule = (id: string, data: UpdateShippingRuleInput): Promise<ShippingRule> =>
  client.put(`/admin/shipping-rules/${id}`, data);

export const deleteShippingRule = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/admin/shipping-rules/${id}`);

export const previewShipping = (data: { goodsAmount: number; regionCode?: string; totalWeight?: number }): Promise<ShippingPreview> =>
  client.post('/admin/shipping-rules/preview', data);
