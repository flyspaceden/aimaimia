/**
 * 发票仓储（Repo）
 *
 * 后端接口：
 * - GET    /api/v1/invoices/profiles       → 发票抬头列表
 * - POST   /api/v1/invoices/profiles       → 新建发票抬头
 * - PATCH  /api/v1/invoices/profiles/:id   → 更新发票抬头
 * - DELETE /api/v1/invoices/profiles/:id   → 删除发票抬头
 * - POST   /api/v1/invoices               → 申请开票
 * - GET    /api/v1/invoices               → 发票列表（分页）
 * - GET    /api/v1/invoices/:id           → 发票详情
 * - POST   /api/v1/invoices/:id/cancel    → 取消开票申请
 */
import {
  Invoice,
  InvoiceProfile,
  CreateInvoiceProfileParams,
  UpdateInvoiceProfileParams,
  RequestInvoiceParams,
  Result,
} from '../types';
import { PaginationResult } from '../types/Pagination';
import { ApiClient } from './http/ApiClient';
import { normalizePagination } from './http/pagination';
import { simulateRequest, createAppError } from './helpers';
import { USE_MOCK } from './http/config';
import { err } from '../types/Result';

// Mock 数据
let mockProfiles: InvoiceProfile[] = [
  {
    id: 'ip-1',
    type: 'PERSONAL',
    title: '张三',
    email: 'zhangsan@example.com',
    phone: '13800138000',
    createdAt: '2026-02-01',
    updatedAt: '2026-02-01',
  },
  {
    id: 'ip-2',
    type: 'COMPANY',
    title: '杭州绿源农业科技有限公司',
    taxNo: '91330100MA2EXAMPLE',
    email: 'finance@lvyuan.com',
    phone: '0571-88888888',
    bankInfo: { bankName: '中国农业银行杭州支行', accountNo: '19000001234567890' },
    address: '浙江省杭州市西湖区文三路138号',
    createdAt: '2026-01-20',
    updatedAt: '2026-01-20',
  },
];

let mockInvoices: Invoice[] = [
  {
    id: 'inv-1',
    orderId: 'o-mock-001',
    profileSnapshot: { type: 'PERSONAL', title: '张三', email: 'zhangsan@example.com' },
    status: 'ISSUED',
    invoiceNo: 'FP20260201001',
    pdfUrl: 'https://example.com/invoice/FP20260201001.pdf',
    issuedAt: '2026-02-02',
    createdAt: '2026-02-01',
    updatedAt: '2026-02-02',
  },
  {
    id: 'inv-2',
    orderId: 'o-mock-002',
    profileSnapshot: { type: 'COMPANY', title: '杭州绿源农业科技有限公司', taxNo: '91330100MA2EXAMPLE' },
    status: 'REQUESTED',
    createdAt: '2026-02-10',
    updatedAt: '2026-02-10',
  },
];

export const InvoiceRepo = {
  /**
   * 发票抬头列表
   * - 后端接口：`GET /api/v1/invoices/profiles`
   */
  getProfiles: async (): Promise<Result<InvoiceProfile[]>> => {
    if (USE_MOCK) {
      return simulateRequest([...mockProfiles]);
    }
    return ApiClient.get<InvoiceProfile[]>('/invoices/profiles');
  },

  /**
   * 新建发票抬头
   * - 后端接口：`POST /api/v1/invoices/profiles`
   */
  createProfile: async (params: CreateInvoiceProfileParams): Promise<Result<InvoiceProfile>> => {
    if (USE_MOCK) {
      const profile: InvoiceProfile = {
        ...params,
        id: `ip-${Date.now()}`,
        createdAt: new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      mockProfiles.push(profile);
      return simulateRequest(profile, { delay: 300 });
    }
    return ApiClient.post<InvoiceProfile>('/invoices/profiles', params);
  },

  /**
   * 更新发票抬头
   * - 后端接口：`PATCH /api/v1/invoices/profiles/:id`
   */
  updateProfile: async (id: string, params: UpdateInvoiceProfileParams): Promise<Result<InvoiceProfile>> => {
    if (USE_MOCK) {
      const profile = mockProfiles.find((p) => p.id === id);
      if (!profile) {
        return err(createAppError('NOT_FOUND', '抬头不存在', '发票抬头未找到'));
      }
      Object.assign(profile, params, { updatedAt: new Date().toISOString().slice(0, 10) });
      return simulateRequest(profile, { delay: 300 });
    }
    return ApiClient.patch<InvoiceProfile>(`/invoices/profiles/${id}`, params);
  },

  /**
   * 删除发票抬头
   * - 后端接口：`DELETE /api/v1/invoices/profiles/:id`
   */
  deleteProfile: async (id: string): Promise<Result<void>> => {
    if (USE_MOCK) {
      mockProfiles = mockProfiles.filter((p) => p.id !== id);
      return simulateRequest(undefined as void, { delay: 200 });
    }
    return ApiClient.delete<void>(`/invoices/profiles/${id}`);
  },

  /**
   * 申请开票
   * - 后端接口：`POST /api/v1/invoices`
   */
  requestInvoice: async (params: RequestInvoiceParams): Promise<Result<Invoice>> => {
    if (USE_MOCK) {
      const profile = mockProfiles.find((p) => p.id === params.profileId);
      if (!profile) {
        return err(createAppError('NOT_FOUND', '抬头不存在', '请先选择发票抬头'));
      }
      const invoice: Invoice = {
        id: `inv-${Date.now()}`,
        orderId: params.orderId,
        profileSnapshot: {
          type: profile.type,
          title: profile.title,
          taxNo: profile.taxNo,
          email: profile.email,
          phone: profile.phone,
          bankInfo: profile.bankInfo,
          address: profile.address,
        },
        status: 'REQUESTED',
        createdAt: new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      mockInvoices = [invoice, ...mockInvoices];
      return simulateRequest(invoice, { delay: 300 });
    }
    return ApiClient.post<Invoice>('/invoices', params);
  },

  /**
   * 发票列表（分页）
   * - 后端接口：`GET /api/v1/invoices?page=&pageSize=`
   */
  getInvoices: async (page?: number, pageSize?: number): Promise<Result<PaginationResult<Invoice>>> => {
    if (USE_MOCK) {
      return simulateRequest({ items: [...mockInvoices], total: mockInvoices.length, page: 1, pageSize: mockInvoices.length });
    }
    const r = await ApiClient.get<{ items: Invoice[]; total: number; page: number; pageSize: number }>('/invoices', {
      page: page ?? 1,
      pageSize: pageSize ?? 20,
    });
    if (!r.ok) return r;
    return { ok: true as const, data: normalizePagination(r.data) };
  },

  /**
   * 发票详情
   * - 后端接口：`GET /api/v1/invoices/:id`
   */
  getInvoiceDetail: async (id: string): Promise<Result<Invoice>> => {
    if (USE_MOCK) {
      const invoice = mockInvoices.find((inv) => inv.id === id);
      if (!invoice) {
        return err(createAppError('NOT_FOUND', '发票不存在', '发票记录未找到'));
      }
      return simulateRequest(invoice);
    }
    return ApiClient.get<Invoice>(`/invoices/${id}`);
  },

  /**
   * 取消开票申请
   * - 后端接口：`POST /api/v1/invoices/:id/cancel`
   */
  cancelInvoice: async (id: string): Promise<Result<{ ok: boolean }>> => {
    if (USE_MOCK) {
      const invoice = mockInvoices.find((inv) => inv.id === id);
      if (!invoice) {
        return err(createAppError('NOT_FOUND', '发票不存在', '发票记录未找到'));
      }
      if (invoice.status !== 'REQUESTED') {
        return err(createAppError('INVALID', '仅待开票的发票可取消', '当前状态不可取消'));
      }
      invoice.status = 'CANCELED';
      invoice.updatedAt = new Date().toISOString().slice(0, 10);
      return simulateRequest({ ok: true }, { delay: 200 });
    }
    return ApiClient.post<{ ok: boolean }>(`/invoices/${id}/cancel`);
  },
};
