export interface InvoiceBuyerSnapshot {
  type?: string;
  title?: string;
  taxNo?: string;
  email?: string;
  phone?: string;
  address?: string;
  bankName?: string;
  bankAccount?: string;
}

export interface InvoiceIssuerProfile {
  companyName: string;
  taxNo: string;
  registeredAddress?: string;
  registeredPhone?: string;
  bankName?: string;
  bankAccount?: string;
  drawer?: string;
  reviewer?: string;
  payee?: string;
}

export interface InvoiceLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: number;
  taxClassificationCode?: string;
}

export interface InvoiceIssueInput {
  invoiceId: string;
  orderId: string;
  providerRequestId: string;
  buyer: InvoiceBuyerSnapshot;
  issuerProfile: InvoiceIssuerProfile;
  lines: InvoiceLineItem[];
  totalAmount: number;
  remark?: string;
}

export interface InvoiceIssueResult {
  invoiceNo: string;
  pdfUrl: string;
  provider: string;
  providerRequestId: string;
  raw?: Record<string, unknown>;
}

export interface InvoiceProvider {
  issue(input: InvoiceIssueInput): Promise<InvoiceIssueResult>;
}
