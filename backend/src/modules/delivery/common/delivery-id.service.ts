import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';

export const DELIVERY_ID_PREFIXES = [
  'PSYH',
  'PSSJ',
  'PSSP',
  'PSDD',
  'PSZDD',
  'PSZF',
  'PSQD',
] as const;

export type DeliveryIdPrefix = (typeof DELIVERY_ID_PREFIXES)[number];

const READABLE_DELIVERY_ID_LENGTH = 17;
const DELIVERY_ID_RETRY_LIMIT = 3;

export function formatDeliveryId(prefix: DeliveryIdPrefix, value: number | bigint): string {
  const numericValue = typeof value === 'bigint' ? value : BigInt(value);
  const paddedWidth = READABLE_DELIVERY_ID_LENGTH - prefix.length;

  if (numericValue < 0n) {
    throw new Error('Delivery sequence value must be non-negative');
  }

  return `${prefix}${numericValue.toString().padStart(paddedWidth, '0')}`;
}

@Injectable()
export class DeliveryIdService {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async next(prefix: DeliveryIdPrefix): Promise<string> {
    for (let attempt = 0; attempt < DELIVERY_ID_RETRY_LIMIT; attempt += 1) {
      try {
        const sequence = await this.deliveryPrisma.$transaction(
          async (tx: Prisma.TransactionClient) =>
            tx.deliverySequence.upsert({
              where: { prefix },
              create: {
                id: prefix,
                prefix,
                currentValue: 1n,
              },
              update: {
                currentValue: {
                  increment: 1n,
                },
              },
              select: {
                currentValue: true,
              },
            }),
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        return formatDeliveryId(prefix, sequence.currentValue);
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < DELIVERY_ID_RETRY_LIMIT - 1) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('配送单号生成冲突，请重试');
  }
}
