const CONTROL_CHAR_REGEX = /[\u0000-\u001f\u007f]/g;
const CN_PHONE_REGEX = /(?<!\d)(1\d{2})\d{4}(\d{4})(?!\d)/g;
// 18 位身份证号：6位地区码 + 8位生日 + 3位顺序码 + 1位校验码（0-9 或 X/x）
const CN_ID_CARD_REGEX = /\b(\d{6})\d{8}(\d{3}[\dXx])\b/g;
const EMAIL_REGEX = /([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const JWT_REGEX = /\b([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\b/g;
const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9\-._~+/=]{16,}\b/gi;

const SENSITIVE_KEY_REGEX = /(?:^|_|-)(password|token|secret|authorization|cookie|set-cookie|accesskey|refreshkey|apikey)(?:$|_|-)/i;

type SanitizeOptions = {
  maxDepth?: number;
  maxArrayLength?: number;
  maxStringLength?: number;
};

export type SanitizedErrorLog = {
  name?: string;
  message: string;
  stack?: string;
};

export function sanitizeForLog(value: unknown, options: SanitizeOptions = {}, depth = 0): unknown {
  const maxDepth = options.maxDepth ?? 4;
  const maxArrayLength = options.maxArrayLength ?? 20;
  const maxStringLength = options.maxStringLength ?? 1000;

  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return sanitizeStringForLog(value, { maxStringLength });
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `<Buffer length=${value.length}>`;
  }

  if (Array.isArray(value)) {
    if (depth >= maxDepth) return `<Array length=${value.length}>`;
    const clipped = value.slice(0, maxArrayLength).map((item) =>
      sanitizeForLog(item, options, depth + 1),
    );
    if (value.length > maxArrayLength) {
      clipped.push(`<+${value.length - maxArrayLength} more items>`);
    }
    return clipped;
  }

  if (typeof value === 'object') {
    if (depth >= maxDepth) return '<Object>';
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        out[key] = redactValue(raw);
        continue;
      }
      out[key] = sanitizeForLog(raw, options, depth + 1);
    }
    return out;
  }

  try {
    return sanitizeStringForLog(String(value), { maxStringLength });
  } catch {
    return '<Unserializable>';
  }
}

export function sanitizeStringForLog(
  value: string,
  options: { maxStringLength?: number } = {},
): string {
  const maxStringLength = options.maxStringLength ?? 1000;

  let text = value.replace(CONTROL_CHAR_REGEX, (ch) => {
    switch (ch) {
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\t': return '\\t';
      default: return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
    }
  });

  text = text
    .replace(CN_ID_CARD_REGEX, '$1********$2')
    .replace(CN_PHONE_REGEX, '$1****$2')
    .replace(BEARER_REGEX, 'Bearer [REDACTED]')
    .replace(JWT_REGEX, '[JWT_REDACTED]')
    .replace(EMAIL_REGEX, (_m, local, domain) => {
      const safeLocal = local.length <= 2 ? `${local[0] ?? '*'}*` : `${local.slice(0, 2)}***`;
      return `${safeLocal}@${domain}`;
    });

  if (text.length > maxStringLength) {
    return `${text.slice(0, maxStringLength)}...(truncated ${text.length - maxStringLength} chars)`;
  }

  return text;
}

export function sanitizeHeadersForLog(headers: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!headers) return {};

  const picked: Record<string, unknown> = {};
  const allowList = [
    'host',
    'x-forwarded-for',
    'x-real-ip',
    'x-request-id',
    'user-agent',
    'content-type',
    'content-length',
    'referer',
    'origin',
    'authorization',
    'cookie',
  ];

  for (const key of allowList) {
    if (headers[key] !== undefined) {
      picked[key] = headers[key];
    }
  }

  return sanitizeForLog(picked) as Record<string, unknown>;
}

function redactValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '[REDACTED]';
  if (typeof raw === 'string' && raw.length <= 8) return '[REDACTED]';
  return '[REDACTED]';
}

export function sanitizeErrorForLog(error: unknown): SanitizedErrorLog {
  if (error instanceof Error) {
    return {
      name: sanitizeStringForLog(error.name, { maxStringLength: 128 }),
      message: sanitizeStringForLog(error.message || 'Unknown error', { maxStringLength: 500 }),
      stack: error.stack ? sanitizeStringForLog(error.stack, { maxStringLength: 4000 }) : undefined,
    };
  }

  if (typeof error === 'string') {
    return {
      message: sanitizeStringForLog(error, { maxStringLength: 500 }),
    };
  }

  return {
    message: JSON.stringify(sanitizeForLog(error)),
  };
}
