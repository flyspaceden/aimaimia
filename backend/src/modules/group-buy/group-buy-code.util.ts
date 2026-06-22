import { randomBytes } from 'crypto';

const GROUP_BUY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateGroupBuyCode(length = 10): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => GROUP_BUY_CODE_ALPHABET[byte % GROUP_BUY_CODE_ALPHABET.length]).join('');
}
