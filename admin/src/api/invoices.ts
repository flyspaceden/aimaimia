import client from './client';
import type { PaginatedData, PaginationParams } from '@/types';

/** 发票状态 */
export type InvoiceStatus = 'REQUESTED' | 'ISSUED' | 'FAILED' | 'CANCELED';

/** 开票模式 */
export type InvoiceIssueMode = 'AUTO' | 'MOCK' | 'MANUAL';

/** 抬头类型 */
export type InvoiceTitleType = 'PERSONAL' | 'COMPANY';

/** 发票查询参数 */
export interface InvoiceQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
}

/** 发票档案快照 */
export interface InvoiceProfileSnapshot {
  type: InvoiceTitleType;
  title: string;
  taxNo?: string | null;
  email?: string | null;
  phone?: string | null;
  bankInfo?: { bankName: string; accountNo: string } | null;
  address?: string | null;
}

/** 发票状态历史 */
export interface InvoiceStatusHistory {
  id: string;
  invoiceId: string;
  fromStatus?: InvoiceStatus | null;
  toStatus: InvoiceStatus;
  reason?: string | null;
  operatorId?: string | null;
  operatorType?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

/** 开票设置 */
export interface InvoiceSettings {
  providerMode: 'MOCK';
  allowVipPackage: boolean;
  lineMode: 'ORDER_ITEMS' | 'MERGED_CATEGORY';
  defaultTaxRate: number;
  defaultTaxClassificationCode: string;
  defaultGoodsName: string;
  remarkTemplate: string;
  issuerProfile: {
    companyName: string;
    taxNo: string;
    registeredAddress?: string;
    registeredPhone?: string;
    bankName?: string;
    bankAccount?: string;
    drawer?: string;
    reviewer?: string;
    payee?: string;
  };
  autoIssue: boolean;
  autoIssueMaxAttempts: number;
}

/** 发票关联的订单项 */
export interface InvoiceOrderItem {
  id: string;
  productTitle: string;
  productImage?: string | null;
  skuName?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

/** 发票关联的订单信息 */
export interface InvoiceOrder {
  id: string;
  orderNo: string;
  totalAmount: number;
  paymentAmount: number;
  shippingFee?: number | null;
  goodsAmount?: number | null;
  status: string;
  createdAt: string;
  items?: InvoiceOrderItem[];
  user?: { id: string; nickname: string | null };
}

/** 发票实体 */
export interface Invoice {
  id: string;
  orderId: string;
  status: InvoiceStatus;
  invoiceNo?: string | null;
  pdfUrl?: string | null;
  failReason?: string | null;
  provider?: string | null;
  providerRequestId?: string | null;
  providerRaw?: Record<string, unknown> | null;
  failedAttempts: number;
  lastAutoIssueAttemptAt?: string | null;
  invoiceContentSnapshot?: Record<string, any> | null;
  requestCount?: number;
  requestedAt?: string | null;
  issuedAt?: string | null;
  failedAt?: string | null;
  canceledAt?: string | null;
  statusHistory?: InvoiceStatusHistory[];
  profileSnapshot: InvoiceProfileSnapshot;
  order?: InvoiceOrder;
  createdAt: string;
  updatedAt: string;
}

/** 发票状态统计 */
export type InvoiceStatsMap = Record<string, number>;

/** 发票列表 */
export const getInvoices = (params?: InvoiceQueryParams): Promise<PaginatedData<Invoice>> =>
  client.get('/admin/invoices', { params });

/** 发票详情 */
export const getInvoiceDetail = (id: string): Promise<Invoice> =>
  client.get(`/admin/invoices/${id}`);

/** 发票状态统计 */
export const getInvoiceStats = (): Promise<InvoiceStatsMap> =>
  client.get('/admin/invoices/stats');

/** 发票设置 */
export const getInvoiceSettings = (): Promise<InvoiceSettings> =>
  client.get('/admin/invoices/settings');

/** 更新发票设置 */
export const updateInvoiceSettings = (
  data: Partial<InvoiceSettings>,
): Promise<{ ok: boolean }> =>
  client.put('/admin/invoices/settings', data);

export type IssueInvoicePayload =
  | { mode: 'AUTO' | 'MOCK' }
  | { mode: 'MANUAL'; invoiceNo: string; pdfUrl: string }
  | { invoiceNo: string; pdfUrl: string };

/** 开票 */
export const issueInvoice = (id: string, data: IssueInvoicePayload): Promise<{ ok: boolean }> =>
  client.post(`/admin/invoices/${id}/issue`, data);

/** 标记失败 */
export const failInvoice = (id: string, data: {
  reason: string;
}): Promise<{ ok: boolean }> =>
  client.post(`/admin/invoices/${id}/fail`, data);

/** 重置卡住的开票 Provider 任务 */
export const resetInvoiceProviderReservation = (id: string): Promise<{
  ok: boolean;
  providerRequestId: string;
}> =>
  client.post(`/admin/invoices/${id}/reset-provider-reservation`);
