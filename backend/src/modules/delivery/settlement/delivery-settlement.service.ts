import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryOrderStatus,
  DeliverySettlementStatus,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { MarkDeliverySettlementPaidDto } from './dto/mark-delivery-settlement-paid.dto';

type ListSettlementsQuery = {
  page?: number;
  pageSize?: number;
  status?: DeliverySettlementStatus | string;
  merchantId?: string;
};

@Injectable()
export class DeliverySettlementService {
  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async listAdminSettlements(query: ListSettlementsQuery) {
    await this.ensureEligibleSettlements(query.merchantId);

    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.DeliverySettlementWhereInput = {};

    if (query.merchantId) {
      where.merchantId = query.merchantId;
    }
    if (query.status && this.isSettlementStatus(query.status)) {
      where.status = query.status;
    }

    const [total, items] = await Promise.all([
      this.deliveryPrisma.deliverySettlement.count({ where }),
      this.deliveryPrisma.deliverySettlement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: pageSize,
        include: {
          merchant: {
            select: {
              id: true,
              name: true,
            },
          },
          subOrder: {
            select: {
              id: true,
              orderId: true,
              status: true,
              totalAmountCents: true,
              shippingFeeShareCents: true,
              deliveredAt: true,
              completedAt: true,
            },
          },
        },
      }),
    ]);

    return {
      items: items.map((item) => this.mapSettlement(item)),
      total,
      page,
      pageSize,
    };
  }

  async listSellerSettlements(merchantId: string, query: Omit<ListSettlementsQuery, 'merchantId'>) {
    return this.listAdminSettlements({
      ...query,
      merchantId,
    });
  }

  async markSettlementPaid(
    deliveryAdminUserId: string,
    settlementId: string,
    dto: MarkDeliverySettlementPaidDto,
  ) {
    return this.deliveryPrisma.$transaction(
      async (tx) => {
        const settlement = await tx.deliverySettlement.findUnique({
          where: { id: settlementId },
        });
        if (!settlement) {
          throw new NotFoundException('配送结算记录不存在');
        }
        if (settlement.status === 'SETTLED') {
          throw new ConflictException('配送结算记录已结清');
        }

        const subOrder = settlement.subOrderId
          ? await tx.deliverySubOrder.findUnique({
              where: { id: settlement.subOrderId },
              select: {
                id: true,
                status: true,
                shippingFeeShareCents: true,
              },
            })
          : null;

        if (!subOrder || !this.isSettlementReady(subOrder.status)) {
          throw new BadRequestException('配送子订单未签收完成，暂不可结算');
        }

        const minimumAmountCents = settlement.supplyAmountCents + subOrder.shippingFeeShareCents;
        if (dto.settledAmountCents < minimumAmountCents) {
          throw new BadRequestException('结算金额不能小于应结金额');
        }

        const updated = await tx.deliverySettlement.update({
          where: { id: settlementId },
          data: {
            status: 'SETTLED',
            settledAmountCents: dto.settledAmountCents,
            note: dto.note?.trim() || settlement.note,
            markedSettledByAdminId: deliveryAdminUserId,
            settledAt: new Date(),
          },
        });

        await tx.deliveryAuditLog.create({
          data: {
            actorType: 'ADMIN',
            actorId: deliveryAdminUserId,
            module: 'delivery-settlement',
            action: 'mark-paid',
            targetType: 'DeliverySettlement',
            targetId: settlementId,
            summary: `配送结算完成：${settlementId}`,
            before: settlement as unknown as Prisma.InputJsonValue,
            after: updated as unknown as Prisma.InputJsonValue,
          },
        });

        return updated;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private async ensureEligibleSettlements(merchantId?: string) {
    const where: Prisma.DeliverySubOrderWhereInput = {
      status: {
        in: ['DELIVERED', 'COMPLETED'],
      },
      settlements: {
        none: {},
      },
    };
    if (merchantId) {
      where.merchantId = merchantId;
    }

    const eligibleSubOrders = await this.deliveryPrisma.deliverySubOrder.findMany({
      where,
      select: {
        id: true,
        merchantId: true,
        status: true,
        supplyAmountCents: true,
        shippingFeeShareCents: true,
        deliveredAt: true,
        completedAt: true,
      },
    });

    if (!eligibleSubOrders.length) {
      return;
    }

    await this.deliveryPrisma.deliverySettlement.createMany({
      data: eligibleSubOrders.map((subOrder) => ({
        merchantId: subOrder.merchantId,
        subOrderId: subOrder.id,
        settlementMonth: this.formatSettlementMonth(subOrder.completedAt ?? subOrder.deliveredAt),
        supplyAmountCents: subOrder.supplyAmountCents,
      })),
      skipDuplicates: true,
    });
  }

  private isSettlementReady(status: DeliveryOrderStatus) {
    return status === 'DELIVERED' || status === 'COMPLETED';
  }

  private isSettlementStatus(value: string): value is DeliverySettlementStatus {
    return value === 'PENDING' || value === 'SETTLED';
  }

  private formatSettlementMonth(date?: Date | null) {
    const value = date ?? new Date();
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private mapSettlement(
    item: Prisma.DeliverySettlementGetPayload<{
      include: {
        merchant: { select: { id: true; name: true } };
        subOrder: {
          select: {
            id: true;
            orderId: true;
            status: true;
            totalAmountCents: true;
            shippingFeeShareCents: true;
            deliveredAt: true;
            completedAt: true;
          };
        };
      };
    }>,
  ) {
    return {
      ...item,
      expectedAmountCents: item.subOrder
        ? item.supplyAmountCents + item.subOrder.shippingFeeShareCents
        : item.settledAmountCents,
    };
  }
}
