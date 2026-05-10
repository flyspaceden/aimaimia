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
  firstWeightKg: number;
  firstFee: number;
  additionalWeightKg: number;
  additionalFee: number;
  minChargeWeightKg: number;
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
  firstWeightKg?: number;
  firstFee?: number;
  additionalWeightKg?: number;
  additionalFee?: number;
  minChargeWeightKg?: number;
  priority?: number;
}

export interface UpdateShippingRuleInput extends Partial<CreateShippingRuleInput> {
  isActive?: boolean;
}

type ShippingFormulaFields = Pick<
  CreateShippingRuleInput,
  | 'firstWeightKg'
  | 'firstFee'
  | 'additionalWeightKg'
  | 'additionalFee'
  | 'minChargeWeightKg'
>;

const hasMissingFormulaField = (data: Partial<ShippingFormulaFields>) =>
  data.firstWeightKg === undefined ||
  data.firstFee === undefined ||
  data.additionalWeightKg === undefined ||
  data.additionalFee === undefined ||
  data.minChargeWeightKg === undefined;

const withLegacyFormulaDefaults = <T extends { fee?: number } & Partial<ShippingFormulaFields>>(
  data: T,
): T => {
  if (data.fee === undefined || !hasMissingFormulaField(data)) {
    return data;
  }

  return {
    ...data,
    firstWeightKg: data.firstWeightKg ?? 3,
    firstFee: data.firstFee ?? data.fee,
    additionalWeightKg: data.additionalWeightKg ?? 1,
    additionalFee: data.additionalFee ?? 0,
    minChargeWeightKg: data.minChargeWeightKg ?? 1,
  };
};

export const createShippingRule = (data: CreateShippingRuleInput): Promise<ShippingRule> =>
  client.post('/admin/shipping-rules', withLegacyFormulaDefaults(data));

export const updateShippingRule = (id: string, data: UpdateShippingRuleInput): Promise<ShippingRule> =>
  client.put(`/admin/shipping-rules/${id}`, withLegacyFormulaDefaults(data));

export const deleteShippingRule = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/admin/shipping-rules/${id}`);

export const previewShipping = (data: { goodsAmount: number; regionCode?: string; totalWeight?: number }): Promise<ShippingPreview> =>
  client.post('/admin/shipping-rules/preview', data);
