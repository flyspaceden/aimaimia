/**
 * claimToken 工具 — 公开抽奖中奖凭证的生成与验证
 *
 * 格式：base64url(payload) + '.' + base64url(signature)
 * payload = JSON.stringify({ fp, prizeId, drawDate, ts })
 * signature = HMAC-SHA256(payload, LOTTERY_CLAIM_SECRET)
 */
import { createHmac, createHash } from 'crypto';

export interface ClaimTokenPayload {
  /** 设备指纹 */
  fp: string;
  /** 奖品 ID */
  prizeId: string;
  /** 抽奖日期 yyyy-MM-dd（UTC+8） */
  drawDate: string;
  /** 签发时间戳 ms */
  ts: number;
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Buffer {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) base64 += '='.repeat(4 - pad);
  return Buffer.from(base64, 'base64');
}

/** 生成 claimToken */
export function generateClaimToken(payload: ClaimTokenPayload, secret: string): string {
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = toBase64Url(Buffer.from(payloadStr, 'utf-8'));
  const signature = createHmac('sha256', secret).update(payloadStr).digest();
  const signatureB64 = toBase64Url(signature);
  return `${payloadB64}.${signatureB64}`;
}

/** 验证 claimToken 签名，返回解码后的 payload；签名无效返回 null */
export function verifyClaimToken(token: string, secret: string): ClaimTokenPayload | null {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return null;

  const payloadB64 = token.slice(0, dotIndex);
  const signatureB64 = token.slice(dotIndex + 1);

  try {
    const payloadStr = fromBase64Url(payloadB64).toString('utf-8');
    const expectedSig = toBase64Url(
      createHmac('sha256', secret).update(payloadStr).digest(),
    );

    if (signatureB64 !== expectedSig) return null;

    const parsed = JSON.parse(payloadStr);
    if (!parsed.fp || !parsed.prizeId || !parsed.drawDate || !parsed.ts) return null;

    return parsed as ClaimTokenPayload;
  } catch {
    return null;
  }
}

/** 计算 claimToken 的 SHA-256 哈希（用作 Redis key） */
export function claimTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
