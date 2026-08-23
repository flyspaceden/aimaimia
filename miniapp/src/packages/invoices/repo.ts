import { ApiClient } from '@/api/client';
import { normalizePageResult } from '@/repos/contracts';
import type { PageResult, Result } from '@/types';
import type { Invoice, InvoiceProfile, InvoiceProfileInput } from './types';

export const MiniInvoiceRepo = {
  getProfiles: () => ApiClient.get<InvoiceProfile[]>('/invoices/profiles'),
  createProfile: (input: InvoiceProfileInput) => ApiClient.post<InvoiceProfile>('/invoices/profiles', input),
  updateProfile: (id: string, input: Partial<InvoiceProfileInput>) => ApiClient.put<InvoiceProfile>(`/invoices/profiles/${id}`, input),
  deleteProfile: (id: string) => ApiClient.delete<{ ok: boolean }>(`/invoices/profiles/${id}`),
  requestInvoice: (input: { orderId: string; profileId: string }) => ApiClient.post<Invoice>('/invoices', input),
  list: async (page = 1, pageSize = 20): Promise<Result<PageResult<Invoice>>> =>
    normalizePageResult<Invoice>(await ApiClient.get<unknown>('/invoices', { page, pageSize }), 'invoice page'),
  getById: (id: string) => ApiClient.get<Invoice>(`/invoices/${id}`),
  cancel: (id: string) => ApiClient.post<{ ok: boolean }>(`/invoices/${id}/cancel`),
};
