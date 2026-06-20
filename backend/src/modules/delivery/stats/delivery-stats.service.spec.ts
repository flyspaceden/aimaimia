import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySettlementService } from '../settlement/delivery-settlement.service';
import { DeliveryStatsService } from './delivery-stats.service';

describe('DeliveryStatsService', () => {
  let deliveryPrisma: any;
  let deliverySettlementService: any;
  let service: DeliveryStatsService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryUser: { count: jest.fn() },
      deliveryUnit: { count: jest.fn() },
      deliveryMerchant: { count: jest.fn() },
      deliveryMerchantApplication: { count: jest.fn() },
      deliveryOrder: { count: jest.fn(), aggregate: jest.fn() },
      deliveryPayment: { count: jest.fn(), aggregate: jest.fn() },
      deliverySettlement: { count: jest.fn(), aggregate: jest.fn() },
      deliveryCustomerServiceConversation: { count: jest.fn() },
    };
    deliverySettlementService = {
      materializeEligibleSettlements: jest.fn(),
    };

    service = new DeliveryStatsService(
      deliveryPrisma as DeliveryPrismaService,
      deliverySettlementService as DeliverySettlementService,
    );
  });

  it('aggregates admin stats from delivery tables only after materializing eligible settlements', async () => {
    let settlementsMaterialized = false;
    deliverySettlementService.materializeEligibleSettlements.mockImplementation(async () => {
      settlementsMaterialized = true;
    });
    deliveryPrisma.deliveryUser.count.mockResolvedValue(12);
    deliveryPrisma.deliveryUnit.count.mockResolvedValue(8);
    deliveryPrisma.deliveryMerchant.count.mockResolvedValue(5);
    deliveryPrisma.deliveryMerchantApplication.count.mockResolvedValue(2);
    deliveryPrisma.deliveryOrder.count.mockResolvedValue(9);
    deliveryPrisma.deliveryOrder.aggregate.mockResolvedValue({
      _sum: { totalAmountCents: 45600 },
    });
    deliveryPrisma.deliveryPayment.count.mockResolvedValue(1);
    deliveryPrisma.deliverySettlement.count.mockImplementation(async () => {
      expect(settlementsMaterialized).toBe(true);
      return 3;
    });
    deliveryPrisma.deliverySettlement.aggregate.mockResolvedValue({
      _sum: { settledAmountCents: 12300 },
    });
    deliveryPrisma.deliveryCustomerServiceConversation.count.mockResolvedValue(4);

    const result = await service.getAdminStats();

    expect(deliverySettlementService.materializeEligibleSettlements).toHaveBeenCalledWith();

    expect(result).toEqual({
      users: 12,
      units: 8,
      merchants: 5,
      pendingMerchantApplications: 2,
      activeOrders: 9,
      totalOrderAmountCents: 45600,
      abnormalPayments: 1,
      pendingSettlements: 3,
      totalSettledAmountCents: 12300,
      openConversations: 4,
    });
  });
});
