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
  matchedRule: { id: string; name: string | null } | null;
  billingWeightKg: number;
  formula: string;
  fallbackUsed: boolean;
  input: {
    goodsAmount: number;
    regionCode?: string;
    totalWeight?: number;
  };
}

export type ShippingRuleImportFormat = 'csv' | 'json';

export interface ShippingRuleImportRequest {
  format: ShippingRuleImportFormat;
  payload: string;
}

export interface ShippingRuleImportError {
  row: number;
  message: string;
}

export interface ShippingRuleImportResult {
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  errors: ShippingRuleImportError[];
  created: number;
  updated: number;
}

export interface ShippingRulePreviewRequest {
  goodsAmount: number;
  regionCode?: string;
  totalWeight?: number;
}

export const listRules = (params?: PaginationParams): Promise<PaginatedData<ShippingRule>> =>
  client.get('/admin/shipping-rules', { params });

export const getShippingRules = listRules;

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
  isActive?: boolean;
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
  client.put(`/admin/shipping-rules/${id}`, data);

export const deleteShippingRule = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/admin/shipping-rules/${id}`);

export const previewRule = (data: ShippingRulePreviewRequest): Promise<ShippingPreview> =>
  client.post('/admin/shipping-rules/preview', data);

export const previewShipping = previewRule;

export const importRulesDryRun = (data: ShippingRuleImportRequest): Promise<ShippingRuleImportResult> =>
  client.post('/admin/shipping-rules/import', { ...data, dryRun: true });

export const importRules = (data: ShippingRuleImportRequest): Promise<ShippingRuleImportResult> =>
  client.post('/admin/shipping-rules/import', { ...data, dryRun: false });

export const downloadTemplate = (): Promise<string> =>
  client.get('/admin/shipping-rules/template');
