import type { InvoiceProfileInput, InvoiceStatus } from './types';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = { REQUESTED: '待开票', ISSUED: '已开票', FAILED: '开票失败', CANCELED: '已取消' };
export function formatTime(value?: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }); }
export function isHttpUrl(value?: string | null): value is string { if (!value) return false; try { const url = new URL(value); return url.protocol === 'https:'; } catch { return false; } }
export function normalizeInvoiceReturnUrl(raw?: string): string {
  if (!raw || raw.length > 512) return '';
  let candidate = raw;
  try { candidate = decodeURIComponent(candidate); } catch { return ''; }
  const match = candidate.match(/^\/packages\/invoices\/invoice-request\/index\?orderId=([^&]+)$/);
  if (!match) return '';
  let orderId = match[1];
  try { orderId = decodeURIComponent(orderId); } catch { return ''; }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) return '';
  return `/packages/invoices/invoice-request/index?orderId=${encodeURIComponent(orderId)}`;
}
export function validateInvoiceProfile(input: InvoiceProfileInput): string | undefined {
  const title = input.title.trim();
  if (title.length < 2 || title.length > 100) return '抬头名称需为 2-100 个字';
  if (input.type === 'COMPANY' && !/^[A-Z0-9]{15,20}$/.test(input.taxNo?.trim() || '')) return '税号需为 15-20 位大写字母或数字';
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return '邮箱格式不正确';
  if (input.phone && !/^1\d{10}$/.test(input.phone.trim())) return '请输入 11 位手机号';
  if (Boolean(input.bankInfo?.bankName) !== Boolean(input.bankInfo?.accountNo)) return '开户行和银行账号需同时填写';
  if ((input.address?.length || 0) > 500) return '注册地址不超过 500 个字';
  return undefined;
}
