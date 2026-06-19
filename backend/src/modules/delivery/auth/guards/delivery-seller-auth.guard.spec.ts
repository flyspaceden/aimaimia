jest.mock('@nestjs/passport', () => {
  class MockAuthGuard {
    async canActivate() {
      return true;
    }
  }

  return {
    AuthGuard: () => MockAuthGuard,
  };
});

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { DeliveryMerchantStatus } from '../../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../../delivery-prisma/delivery-prisma.service';
import { DeliverySellerAuthGuard } from './delivery-seller-auth.guard';

describe('DeliverySellerAuthGuard', () => {
  let deliveryPrisma: {
    deliveryMerchant: {
      findUnique: jest.Mock;
    };
  };

  const createContext = (user: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryMerchant: {
        findUnique: jest.fn(),
      },
    };
  });

  it('allows active merchants', async () => {
    deliveryPrisma.deliveryMerchant.findUnique.mockResolvedValue({
      status: DeliveryMerchantStatus.ACTIVE,
    });
    const guard = new DeliverySellerAuthGuard(
      deliveryPrisma as unknown as DeliveryPrismaService,
    );

    await expect(
      guard.canActivate(createContext({ merchantId: 'merchant_001' })),
    ).resolves.toBe(true);
    expect(deliveryPrisma.deliveryMerchant.findUnique).toHaveBeenCalledWith({
      where: { id: 'merchant_001' },
      select: { status: true },
    });
  });

  it('rejects missing merchants', async () => {
    deliveryPrisma.deliveryMerchant.findUnique.mockResolvedValue(null);
    const guard = new DeliverySellerAuthGuard(
      deliveryPrisma as unknown as DeliveryPrismaService,
    );

    await expect(
      guard.canActivate(createContext({ merchantId: 'merchant_001' })),
    ).rejects.toThrow('配送中心商家已停用，请联系平台管理员');
  });

  it('rejects inactive merchants', async () => {
    deliveryPrisma.deliveryMerchant.findUnique.mockResolvedValue({
      status: DeliveryMerchantStatus.PENDING,
    });
    const guard = new DeliverySellerAuthGuard(
      deliveryPrisma as unknown as DeliveryPrismaService,
    );

    await expect(
      guard.canActivate(createContext({ merchantId: 'merchant_001' })),
    ).rejects.toThrow(new ForbiddenException('配送中心商家已停用，请联系平台管理员'));
  });
});
