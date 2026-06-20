import { Injectable } from '@nestjs/common';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySettlementService } from '../settlement/delivery-settlement.service';

@Injectable()
export class DeliveryStatsService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliverySettlementService: DeliverySettlementService,
  ) {}

  async getAdminStats() {
    await this.deliverySettlementService.materializeEligibleSettlements();

    const [
      users,
      units,
      merchants,
      pendingMerchantApplications,
      activeOrders,
      orderAmount,
      abnormalPayments,
      pendingSettlements,
      settledAmount,
      openConversations,
    ] = await Promise.all([
      this.deliveryPrisma.deliveryUser.count(),
      this.deliveryPrisma.deliveryUnit.count(),
      this.deliveryPrisma.deliveryMerchant.count(),
      this.deliveryPrisma.deliveryMerchantApplication.count({
        where: { status: 'PENDING' },
      }),
      this.deliveryPrisma.deliveryOrder.count({
        where: {
          status: {
            in: ['PENDING_SHIPMENT', 'SHIPPED', 'DELIVERED'],
          },
        },
      }),
      this.deliveryPrisma.deliveryOrder.aggregate({
        _sum: {
          totalAmountCents: true,
        },
      }),
      this.deliveryPrisma.deliveryPayment.count({
        where: {
          status: 'FAILED',
        },
      }),
      this.deliveryPrisma.deliverySettlement.count({
        where: {
          status: 'PENDING',
        },
      }),
      this.deliveryPrisma.deliverySettlement.aggregate({
        _sum: {
          settledAmountCents: true,
        },
      }),
      this.deliveryPrisma.deliveryCustomerServiceConversation.count({
        where: {
          status: 'OPEN',
        },
      }),
    ]);

    return {
      users,
      units,
      merchants,
      pendingMerchantApplications,
      activeOrders,
      totalOrderAmountCents: orderAmount._sum.totalAmountCents ?? 0,
      abnormalPayments,
      pendingSettlements,
      totalSettledAmountCents: settledAmount._sum.settledAmountCents ?? 0,
      openConversations,
    };
  }
}
