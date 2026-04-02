/**
 * 域模型：发票（Invoice）
 *
 * 用途：
 * - 发票抬头管理、发票申请/查看/取消
 *
 * 后端接入建议：
 * - 发票状态由后端推进（开票成功/失败），前端只做展示与触发
 */

/** 发票类型 */
export type InvoiceType = 'PERSONAL' | 'COMPANY';

/** 发票状态 */
export type InvoiceStatus = 'REQUESTED' | 'ISSUED' | 'FAILED' | 'CANCELED';

/** 发票抬头资料快照（存储在发票记录中，不随抬头修改变化） */
export type InvoiceProfileSnapshot = {
  type: InvoiceType;
  title: string;
  taxNo?: string;
  email?: string;
  phone?: string;
  bankInfo?: {
    bankName: string;
    accountNo: string;
  };
  address?: string;
};

/** 发票抬头（用户管理的模板） */
export type InvoiceProfile = {
  id: string;
  type: InvoiceType;
  title: string;
  taxNo?: string;
  email?: string;
  phone?: string;
  bankInfo?: {
    bankName: string;
    accountNo: string;
  };
  address?: string;
  createdAt: string;
  updatedAt: string;
};

/** 发票记录 */
export type Invoice = {
  id: string;
  orderId: string;
  profileSnapshot: InvoiceProfileSnapshot;
  status: InvoiceStatus;
  invoiceNo?: string;
  pdfUrl?: string;
  issuedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** 创建发票抬头参数 */
export type CreateInvoiceProfileParams = {
  type: InvoiceType;
  title: string;
  taxNo?: string;
  email?: string;
  phone?: string;
  bankInfo?: {
    bankName: string;
    accountNo: string;
  };
  address?: string;
};

/** 更新发票抬头参数 */
export type UpdateInvoiceProfileParams = Partial<CreateInvoiceProfileParams>;

/** 申请开票参数 */
export type RequestInvoiceParams = {
  orderId: string;
  profileId: string;
};

/** 发票列表分页响应 */
export type InvoiceListResponse = {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
};
