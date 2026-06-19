import client from './client';
import type {
  DeliveryAbnormalPayment,
  DeliveryAuditLog,
  DeliveryConfigItem,
  DeliveryConversation,
  DeliveryManifestTemplate,
  DeliveryMerchantApplicationDetail,
  DeliveryMerchantApplicationSummary,
  DeliveryMerchantDetail,
  DeliveryMerchantSummary,
  DeliveryOrderDetail,
  DeliveryOrderSummary,
  DeliveryPriceRule,
  DeliveryProduct,
  DeliverySettlement,
  DeliveryShippingRecord,
  DeliveryStats,
  DeliveryUnitDetail,
  DeliveryUnitFieldConfig,
  DeliveryUnitSummary,
  DeliveryUserDetail,
  DeliveryUserSummary,
  JsonValue,
  PagedResult,
} from '@/types/delivery-management';

type PaginationParams = {
  page?: number;
  pageSize?: number;
};

type QueryValue = string | number | boolean | null | undefined;

function withQuery<T extends Record<string, QueryValue>>(path: string, params?: T) {
  if (!params) {
    return path;
  }
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export const getDeliveryStats = (): Promise<DeliveryStats> => client.get('/delivery-admin/stats');

export const getDeliveryUsers = (
  params?: PaginationParams & { keyword?: string },
): Promise<PagedResult<DeliveryUserSummary>> => client.get(withQuery('/delivery-admin/users', params));

export const getDeliveryUser = (id: string): Promise<DeliveryUserDetail> =>
  client.get(`/delivery-admin/users/${id}`);

export const getDeliveryUnits = (
  params?: PaginationParams & { status?: string },
): Promise<PagedResult<DeliveryUnitSummary>> => client.get(withQuery('/delivery-admin/units', params));

export const getDeliveryUnit = (id: string): Promise<DeliveryUnitDetail> =>
  client.get(`/delivery-admin/units/${id}`);

export const getDeliveryMerchants = (
  params?: PaginationParams & { status?: string; keyword?: string },
): Promise<PagedResult<DeliveryMerchantSummary>> => client.get(withQuery('/delivery-admin/merchants', params));

export const getDeliveryMerchant = (id: string): Promise<DeliveryMerchantDetail> =>
  client.get(`/delivery-admin/merchants/${id}`);

export const updateDeliveryMerchant = (
  id: string,
  payload: {
    name?: string;
    status?: string;
    servicePhone?: string;
    defaultMarkupBps?: number;
  },
): Promise<DeliveryMerchantDetail> => client.patch(`/delivery-admin/merchants/${id}`, payload);

export const getDeliveryMerchantApplications = (
  params?: PaginationParams & { status?: string },
): Promise<PagedResult<DeliveryMerchantApplicationSummary>> =>
  client.get(withQuery('/delivery-admin/merchant-applications', params));

export const getDeliveryMerchantApplication = (id: string): Promise<DeliveryMerchantApplicationDetail> =>
  client.get(`/delivery-admin/merchant-applications/${id}`);

export const reviewDeliveryMerchantApplication = (
  id: string,
  payload: {
    status: 'APPROVED' | 'REJECTED';
    rejectReason?: string;
    merchantId?: string;
  },
): Promise<DeliveryMerchantApplicationDetail> =>
  client.patch(`/delivery-admin/merchant-applications/${id}/review`, payload);

export const getDeliveryProducts = (params?: {
  merchantId?: string;
  status?: string;
  auditStatus?: string;
  keyword?: string;
}): Promise<{ items: DeliveryProduct[] }> => client.get(withQuery('/delivery-admin/products', params));

export const approveDeliveryProduct = (id: string, note?: string): Promise<DeliveryProduct> =>
  client.post(`/delivery-admin/products/${id}/approve`, { note });

export const rejectDeliveryProduct = (id: string, note?: string): Promise<DeliveryProduct> =>
  client.post(`/delivery-admin/products/${id}/reject`, { note });

export const getDeliveryPricingRules = (params?: {
  scope?: string;
  ruleType?: string;
  merchantId?: string;
  productId?: string;
  skuId?: string;
  isActive?: 'true' | 'false';
}): Promise<{ items: DeliveryPriceRule[] }> =>
  client.get(withQuery('/delivery-admin/pricing-rules', params));

export const createDeliveryPricingRule = (payload: {
  scope: string;
  ruleType: string;
  merchantId?: string;
  productId?: string;
  skuId?: string;
  minQuantity: number;
  maxQuantity?: number | null;
  fixedPriceCents?: number | null;
  markupBps?: number | null;
  priority?: number;
  isActive?: boolean;
  note?: string | null;
}): Promise<DeliveryPriceRule> => client.post('/delivery-admin/pricing-rules', payload);

export const updateDeliveryPricingRule = (
  id: string,
  payload: Partial<{
    scope: string;
    ruleType: string;
    merchantId: string;
    productId: string;
    skuId: string;
    minQuantity: number;
    maxQuantity: number | null;
    fixedPriceCents: number | null;
    markupBps: number | null;
    priority: number;
    isActive: boolean;
    note: string | null;
  }>,
): Promise<DeliveryPriceRule> => client.patch(`/delivery-admin/pricing-rules/${id}`, payload);

export const getDeliveryOrders = (
  params?: PaginationParams & { status?: string },
): Promise<PagedResult<DeliveryOrderSummary>> => client.get(withQuery('/delivery-admin/orders', params));

export const getDeliveryOrder = (id: string): Promise<DeliveryOrderDetail> =>
  client.get(`/delivery-admin/orders/${id}`);

export const getDeliveryShippingRecords = (
  params?: PaginationParams,
): Promise<PagedResult<DeliveryShippingRecord>> =>
  client.get(withQuery('/delivery-admin/shipping-records', params));

export const getDeliveryAbnormalPayments = (
  params?: PaginationParams,
): Promise<PagedResult<DeliveryAbnormalPayment>> =>
  client.get(withQuery('/delivery-admin/payments/abnormal', params));

export const getDeliveryManifests = (): Promise<DeliveryManifestTemplate[]> =>
  client.get('/delivery-admin/manifests');

export const regenerateDeliveryManifest = (
  id: string,
  payload: {
    name?: string;
    description?: string;
    columns?: Array<{
      key: string;
      label?: string;
      sortOrder?: number;
      visible?: boolean;
    }>;
  },
): Promise<{
  id: string;
  templateId: string;
  versionNo: number;
  status: string;
  config: JsonValue;
}> => client.post(`/delivery-admin/manifests/${id}/regenerate`, payload);

export const getDeliverySettlements = (
  params?: PaginationParams & { status?: string },
): Promise<PagedResult<DeliverySettlement>> => client.get(withQuery('/delivery-admin/settlements', params));

export const markDeliverySettlementPaid = (
  id: string,
  payload: { settledAmountCents: number; note?: string },
): Promise<DeliverySettlement> => client.patch(`/delivery-admin/settlements/${id}/paid`, payload);

export const getDeliveryCustomerServiceList = (params?: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<DeliveryConversation[]> => client.get(withQuery('/delivery-admin/cs', params));

export const getDeliveryCustomerServiceDetail = (id: string): Promise<DeliveryConversation> =>
  client.get(`/delivery-admin/cs/${id}`);

export const updateDeliveryCustomerService = (
  id: string,
  payload: {
    subject?: string;
    message?: string;
    status?: 'OPEN' | 'CLOSED';
    assignedAdminId?: string;
    assignedStaffId?: string;
  },
): Promise<DeliveryConversation> => client.patch(`/delivery-admin/cs/${id}`, payload);

export const getDeliveryAuditLogs = (
  params?: PaginationParams & { keyword?: string },
): Promise<PagedResult<DeliveryAuditLog>> => client.get(withQuery('/delivery-admin/audit', params));

export const getDeliveryConfig = (scope?: string): Promise<DeliveryConfigItem[]> =>
  client.get(withQuery('/delivery-admin/config', scope ? { scope } : undefined));

export const updateDeliveryConfig = (
  items: Array<{
    key: string;
    value: JsonValue;
    description?: string;
    scope?: string;
  }>,
): Promise<DeliveryConfigItem[]> => client.patch('/delivery-admin/config', { items });

export const getDeliveryUnitFieldConfig = (): Promise<DeliveryUnitFieldConfig[]> =>
  client.get('/delivery-admin/unit-field-config');

export const updateDeliveryUnitFieldConfig = (
  items: Array<{
    fieldKey: string;
    label?: string;
    fieldType?: string;
    sortOrder?: number;
    placeholder?: string;
    options?: JsonValue;
    isVisible?: boolean;
    isRequired?: boolean;
    showInApp?: boolean;
    showInAdmin?: boolean;
    includeInPdf?: boolean;
    includeInExcel?: boolean;
  }>,
): Promise<DeliveryUnitFieldConfig[]> => client.patch('/delivery-admin/unit-field-config', { items });
