import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySettlementService } from '../settlement/delivery-settlement.service';
import { DeliverySellerOpsService } from './delivery-seller-ops.service';

describe('DeliverySellerOpsService', () => {
  let deliveryPrisma: any;
  let deliverySettlementService: any;
  let service: DeliverySellerOpsService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryMerchant: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
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

  it('sanitizes seller company responses so default markup is never exposed', async () => {
    deliveryPrisma.deliveryMerchant.findUnique.mockResolvedValue({
      id: 'merchant_1',
      name: '配送中心A',
      contactName: '张三',
      defaultMarkupBps: 1800,
    });

    await expect(service.getCompany('merchant_1')).resolves.toEqual({
      id: 'merchant_1',
      name: '配送中心A',
      contactName: '张三',
    });
  });

  it('ignores default markup changes from seller company updates and strips it from the response', async () => {
    deliveryPrisma.deliveryMerchant.update.mockResolvedValue({
      id: 'merchant_1',
      name: '配送中心A',
      contactName: '张三',
      contactPhone: '13800000000',
      servicePhone: '400-800-9000',
      defaultMarkupBps: 2600,
    });

    await expect(
      service.updateCompany('merchant_1', {
        name: ' 配送中心A ',
        defaultMarkupBps: 9900,
      } as any),
    ).resolves.toEqual({
      id: 'merchant_1',
      name: '配送中心A',
      contactName: '张三',
      contactPhone: '13800000000',
      servicePhone: '400-800-9000',
    });

    expect(deliveryPrisma.deliveryMerchant.update).toHaveBeenCalledWith({
      where: { id: 'merchant_1' },
      data: {
        name: '配送中心A',
        contactName: undefined,
        contactPhone: undefined,
        servicePhone: undefined,
      },
    });
  });
});
