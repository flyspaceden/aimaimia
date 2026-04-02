import { decryptJsonValue } from './encryption';

export function maskPhone(value?: string | null): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  const digits = text.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
  }

  if (text.length <= 4) return '[PHONE_MASKED]';
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

export function maskEmail(value?: string | null): string | null {
  if (!value) return null;
  const text = String(value).trim();
  const at = text.indexOf('@');
  if (at <= 0) return maskPhone(text);

  const local = text.slice(0, at);
  const domain = text.slice(at + 1);
  const safeLocal =
    local.length <= 2 ? `${local.slice(0, 1)}*` : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

export function maskContact(value?: string | null): string | null {
  if (!value) return null;
  return value.includes('@') ? maskEmail(value) : maskPhone(value);
}

export function maskName(value?: string | null): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length === 1) return '*';
  if (text.length === 2) return `${text[0]}*`;
  return `${text[0]}*${text[text.length - 1]}`;
}

export function maskTrackingNo(value?: string | null): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length <= 8) return '[TRACKING_MASKED]';
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

export function maskAddressDetail(value?: string | null): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length <= 6) return `${text.slice(0, 1)}***`;
  return `${text.slice(0, 4)}***${text.slice(-2)}`;
}

export function maskIp(value?: string | null): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    const parts = text.split('.');
    return `${parts[0]}.${parts[1]}.*.*`;
  }

  if (text.includes(':')) {
    const parts = text.split(':').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}:*`;
    return '[IPV6_MASKED]';
  }

  if (text.length <= 6) return '[IP_MASKED]';
  return `${text.slice(0, 3)}***${text.slice(-2)}`;
}

export function maskAddressSnapshot<T = unknown>(snapshot: T): T {
  const resolved = decryptJsonValue<T>(snapshot);
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    return snapshot;
  }

  const raw = resolved as Record<string, unknown>;
  const out: Record<string, unknown> = { ...raw };

  if (typeof raw.recipientName === 'string') {
    out.recipientName = maskName(raw.recipientName);
  }
  if (typeof raw.phone === 'string') {
    out.phone = maskPhone(raw.phone);
  }
  if (typeof raw.detail === 'string') {
    out.detail = maskAddressDetail(raw.detail);
  }

  return out as T;
}

/**
 * 从地址快照中提取省市区文本（不含街道门牌号）
 * 用于卖家端展示配送区域
 */
export function extractRegionText(snapshot: unknown): string | null {
  const resolved = decryptJsonValue<Record<string, unknown> | null>(snapshot);
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    return null;
  }
  const raw = resolved;

  // 优先使用 regionText 字段
  if (typeof raw.regionText === 'string' && raw.regionText.trim()) {
    return raw.regionText.trim();
  }

  // 拼接 province + city + district
  const parts = [raw.province, raw.city, raw.district]
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => (p as string).trim());
  return parts.length > 0 ? parts.join('') : null;
}

/**
 * 过滤文本中的联系方式（手机号、座机、邮箱、微信号、QQ号）
 * 用于卖家端展示买家退换货理由时，防止泄露联系方式
 */
export function filterContactInfo(text: string): string {
  if (!text) return text;
  return text
    .replace(/1[3-9]\d{9}/g, '***')              // 手机号
    .replace(/\d{3,4}-\d{7,8}/g, '***')          // 座机
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '***')     // 邮箱
    .replace(/微信[号:：]?\s*\S+/gi, '***')       // 微信号
    .replace(/(?:wx|vx)[号:：]?\s*[a-z][a-z0-9_-]{3,}/gi, '***') // 微信缩写
    .replace(/v信[号:：]?\s*\S+/gi, '***')        // v信
    .replace(/[Ww]e?[Cc]hat[号:：]?\s*\S+/g, '***') // WeChat
    .replace(/QQ[号:：]?\s*\d+/gi, '***');        // QQ号
}
