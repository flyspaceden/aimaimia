import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const JSON_ENVELOPE_VERSION = 'v1';
const TEXT_PREFIX = 'enc:v1:';
const IV_LENGTH = 12;

type EncryptedJsonEnvelope = {
  __enc: 'v1';
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
};

function deriveKey(): Buffer {
  const secret =
    process.env.DATA_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'nongmai-dev-data-key';
  return createHash('sha256').update(secret).digest();
}

function encryptPayload(plainText: string) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptPayload(iv: string, tag: string, data: string): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function isEncryptedJsonEnvelope(
  value: unknown,
): value is EncryptedJsonEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const raw = value as Record<string, unknown>;
  return (
    raw.__enc === JSON_ENVELOPE_VERSION &&
    raw.alg === 'aes-256-gcm' &&
    typeof raw.iv === 'string' &&
    typeof raw.tag === 'string' &&
    typeof raw.data === 'string'
  );
}

export function encryptJsonValue<T>(value: T): T | EncryptedJsonEnvelope {
  if (value == null || isEncryptedJsonEnvelope(value)) {
    return value as T | EncryptedJsonEnvelope;
  }

  const payload = encryptPayload(JSON.stringify(value));
  return {
    __enc: JSON_ENVELOPE_VERSION,
    alg: 'aes-256-gcm',
    ...payload,
  };
}

export function decryptJsonValue<T>(value: unknown): T {
  if (value == null) {
    return value as T;
  }

  try {
    if (isEncryptedJsonEnvelope(value)) {
      return JSON.parse(
        decryptPayload(value.iv, value.tag, value.data),
      ) as T;
    }

    if (typeof value === 'string') {
      const parsed = JSON.parse(value);
      if (isEncryptedJsonEnvelope(parsed)) {
        return JSON.parse(
          decryptPayload(parsed.iv, parsed.tag, parsed.data),
        ) as T;
      }
    }
  } catch {
    return value as T;
  }

  return value as T;
}

export function encryptText(value?: string | null): string | null {
  if (!value) return value ?? null;
  if (value.startsWith(TEXT_PREFIX)) return value;

  const payload = encryptPayload(value);
  return `${TEXT_PREFIX}${payload.iv}.${payload.tag}.${payload.data}`;
}

export function decryptText(value?: string | null): string | null {
  if (!value) return value ?? null;
  if (!value.startsWith(TEXT_PREFIX)) return value;

  try {
    const encoded = value.slice(TEXT_PREFIX.length);
    const [iv, tag, data] = encoded.split('.');
    if (!iv || !tag || !data) {
      return value;
    }
    return decryptPayload(iv, tag, data);
  } catch {
    return value;
  }
}
