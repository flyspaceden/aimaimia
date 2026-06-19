import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySettlementService } from '../settlement/delivery-settlement.service';
import { DeliverySellerOpsService } from './delivery-seller-ops.service';

describe('DeliverySellerOpsService', () => {
  let deliveryPrisma: any;
  let deliverySettlementService: any;
  let service: DeliverySellerOpsService;

  beforeEach(() => {
    deliveryPrisma = {
      deliverySubOrder: {
        count: jest.fn(),
      },
      deliverySettlement: {
        count: jest.fn(),
      },
      deliveryCustomerServiceConversation: {
        count: jest.fn(),
      },
    };
    deliverySettlementService = {
      materializeEligibleSettlements: jest.fn(),
    };

    service = new DeliverySellerOpsService(
      deliveryPrisma as DeliveryPrismaService,
      deliverySettlementService as DeliverySettlementService,
    );
  });

  it('materializes eligible settlements before computing dashboard counts', async () => {
    let settlementsMaterialized = false;
    deliverySettlementService.materializeEligibleSettlements.mockImplementation(async () => {
      settlementsMaterialized = true;
    });
    deliveryPrisma.deliverySubOrder.count.mockResolvedValue(5);
    deliveryPrisma.deliverySettlement.count.mockImplementation(async () => {
      expect(settlementsMaterialized).toBe(true);
      return 2;
    });
    deliveryPrisma.deliveryCustomerServiceConversation.count.mockResolvedValue(4);

    await expect(service.getDashboard('merchant_1')).resolves.toEqual({
      pendingShipmentCount: 5,
      deliveredPendingSettlementCount: 2,
      openConversationCount: 4,
    });

    expect(deliverySettlementService.materializeEligibleSettlements).toHaveBeenCalledWith({
      merchantId: 'merchant_1',
    });
  });
});
