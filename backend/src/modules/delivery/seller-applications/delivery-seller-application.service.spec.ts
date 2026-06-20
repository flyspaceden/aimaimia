import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySellerApplicationService } from './delivery-seller-application.service';

describe('DeliverySellerApplicationService', () => {
  let deliveryPrisma: {
    deliveryMerchantApplication: {
      create: jest.Mock;
    };
  };
  let service: DeliverySellerApplicationService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryMerchantApplication: {
        create: jest.fn().mockResolvedValue({
          id: 'apply_1',
          companyName: '青禾配送中心',
          contactPhone: '13800000000',
          status: 'PENDING',
        }),
      },
    };
    service = new DeliverySellerApplicationService(
      deliveryPrisma as unknown as DeliveryPrismaService,
    );
  });

  it('creates a public delivery merchant application without seller login', async () => {
    await expect(
      service.create({
        companyName: '青禾配送中心',
        contactName: '张三',
        contactPhone: '13800000000',
        email: 'ops@example.com',
        note: '申请入驻配送中心',
        licenseFileUrl: 'https://example.com/license.pdf',
      }),
    ).resolves.toMatchObject({
      application: {
        id: 'apply_1',
        status: 'PENDING',
      },
    });

    expect(deliveryPrisma.deliveryMerchantApplication.create).toHaveBeenCalledWith({
      data: {
        companyName: '青禾配送中心',
        contactName: '张三',
        contactPhone: '13800000000',
        email: 'ops@example.com',
        note: '申请入驻配送中心',
        licenseFileUrl: 'https://example.com/license.pdf',
      },
    });
  });
});
