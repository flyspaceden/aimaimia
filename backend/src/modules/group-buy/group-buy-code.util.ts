import { randomBytes } from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const GROUP_BUY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateGroupBuyCode(length = 10): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => GROUP_BUY_CODE_ALPHABET[byte % GROUP_BUY_CODE_ALPHABET.length]).join('');
}

export async function generateUniqueGroupBuyCode(tx: Prisma.TransactionClient) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGroupBuyCode();
    const existing = await tx.groupBuyCode.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new InternalServerErrorException('团购推荐码生成失败');
}
