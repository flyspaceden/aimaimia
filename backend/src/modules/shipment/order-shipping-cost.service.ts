import { Injectable, Logger } from '@nestjs/common';
import { OrderShippingCost, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrderShippingCostService {
  private readonly logger = new Logger(OrderShippingCostService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordPackage(input: {
    orderId: string;
    packageIndex: number;
    companyId?: string | null;
    sfOrderId: string;
    weightGramSent: number;
    estimatedCost?: number;
  }, tx?: Prisma.TransactionClient): Promise<OrderShippingCost | null> {
    const db = tx ?? this.prisma;

    try {
      return await db.orderShippingCost.upsert({
        where: { sfOrderId: input.sfOrderId },
        create: {
          orderId: input.orderId,
          packageIndex: input.packageIndex,
          companyId: input.companyId ?? null,
          sfOrderId: input.sfOrderId,
          weightGramSent: input.weightGramSent,
          estimatedCost: input.estimatedCost,
        },
        update: {
          orderId: input.orderId,
          packageIndex: input.packageIndex,
          companyId: input.companyId ?? null,
          weightGramSent: input.weightGramSent,
          estimatedCost: input.estimatedCost,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `OrderShippingCost 写入失败，不阻塞发货: sfOrderId=${input.sfOrderId}, err=${err.message}`,
      );
      return null;
    }
  }

  async reconcile(sfOrderId: string, actualCost: number): Promise<void> {
    await this.prisma.orderShippingCost.update({
      where: { sfOrderId },
      data: {
        actualCost,
        reconciledAt: new Date(),
      },
    });
  }
}
