import { Prisma } from '@prisma/client';

export const NORMAL_SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateNormalShareCode(random: () => number = Math.random) {
  let code = 'S';
  for (let i = 0; i < 7; i += 1) {
    code += NORMAL_SHARE_CODE_ALPHABET.charAt(Math.floor(random() * NORMAL_SHARE_CODE_ALPHABET.length));
  }
  return code;
}

export async function pickUniqueNormalShareCode(tx: Prisma.TransactionClient) {
  for (let i = 0; i < 10; i += 1) {
    const code = generateNormalShareCode();
    const existing = await tx.normalShareProfile.findUnique({
      where: { code },
    });
    if (!existing) {
      return code;
    }
  }
  throw new Error('pickUniqueNormalShareCode: 10 次尝试均冲突');
}
