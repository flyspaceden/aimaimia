import type { PageResult } from '@/types';

export type InvoiceType = 'PERSONAL' | 'COMPANY';
export type InvoiceStatus = 'REQUESTED' | 'ISSUED' | 'FAILED' | 'CANCELED';
export type InvoiceProfileInput = {
  type: InvoiceType; title: string; taxNo?: string; email?: string; phone?: string;
  bankInfo?: { bankName: string; accountNo: string }; address?: string;
};
export type InvoiceProfile = InvoiceProfileInput & { id: string; createdAt: string; updatedAt: string };
export type InvoiceHistory = { id: string; fromStatus?: InvoiceStatus | null; toStatus: InvoiceStatus; reason?: string | null; operatorType?: string; createdAt: string };
export type Invoice = {
  id: string; orderId: string; profileSnapshot: InvoiceProfileInput; status: InvoiceStatus;
  invoiceNo?: string | null; pdfUrl?: string | null; failReason?: string | null; requestedAt: string;
  issuedAt?: string | null; failedAt?: string | null; canceledAt?: string | null; createdAt: string; updatedAt: string;
  statusHistory?: InvoiceHistory[]; order?: { id: string; totalAmount: number; goodsAmount?: number; shippingFee?: number; status?: string; createdAt: string };
};
export type InvoicePage = PageResult<Invoice>;
