import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryStatsService } from './delivery-stats.service';

describe('DeliveryStatsService', () => {
  let deliveryPrisma: any;
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

    service = new DeliveryStatsService(deliveryPrisma as DeliveryPrismaService);
  });

  it('aggregates admin stats from delivery tables only', async () => {
    deliveryPrisma.deliveryUser.count.mockResolvedValue(12);
    deliveryPrisma.deliveryUnit.count.mockResolvedValue(8);
    deliveryPrisma.deliveryMerchant.count.mockResolvedValue(5);
    deliveryPrisma.deliveryMerchantApplication.count.mockResolvedValue(2);
    deliveryPrisma.deliveryOrder.count.mockResolvedValue(9);
    deliveryPrisma.deliveryOrder.aggregate.mockResolvedValue({
      _sum: { totalAmountCents: 45600 },
    });
    deliveryPrisma.deliveryPayment.count.mockResolvedValue(1);
    deliveryPrisma.deliverySettlement.count.mockResolvedValue(3);
    deliveryPrisma.deliverySettlement.aggregate.mockResolvedValue({
      _sum: { settledAmountCents: 12300 },
    });
    deliveryPrisma.deliveryCustomerServiceConversation.count.mockResolvedValue(4);

    const result = await service.getAdminStats();

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
