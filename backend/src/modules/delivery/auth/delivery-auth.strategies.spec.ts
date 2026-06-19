import { ConfigService } from '@nestjs/config';
import {
  DeliveryAdminUserStatus,
  DeliverySellerStaffRole,
  DeliverySellerStaffStatus,
  DeliveryUserStatus,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import {
  DeliveryAdminJwtPayload,
  DeliveryAdminJwtStrategy,
} from './delivery-admin-jwt.strategy';
import {
  DeliverySellerJwtPayload,
  DeliverySellerJwtStrategy,
} from './delivery-seller-jwt.strategy';
import {
  DeliveryUserJwtPayload,
  DeliveryUserJwtStrategy,
} from './delivery-user-jwt.strategy';

type ConfigMock = {
  getOrThrow: jest.Mock<string, [string]>;
};

describe('Delivery JWT strategies', () => {
  let configService: ConfigMock;

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn((key: string) => `secret-for:${key}`),
    };
  });

  describe('DeliveryUserJwtStrategy', () => {
    let prisma: {
      deliveryUser: {
        findUnique: jest.Mock;
      };
      deliveryUserSession: {
        findFirst: jest.Mock;
      };
    };

    beforeEach(() => {
      prisma = {
        deliveryUser: {
          findUnique: jest.fn(),
        },
        deliveryUserSession: {
          findFirst: jest.fn(),
        },
      };
    });

    it('validates active delivery sessions when sessionId is present', async () => {
      prisma.deliveryUserSession.findFirst.mockResolvedValue({
        id: 'dusess_1',
      });
      prisma.deliveryUser.findUnique.mockResolvedValue({
        status: DeliveryUserStatus.ACTIVE,
      });
      const strategy = new DeliveryUserJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dusr_001',
          type: 'delivery-user',
          sessionId: 'dusess_1',
        } as DeliveryUserJwtPayload),
      ).resolves.toEqual({
        sub: 'dusr_001',
        deliveryUserId: 'dusr_001',
        type: 'delivery-user',
        sessionId: 'dusess_1',
      });
      expect(prisma.deliveryUserSession.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'dusess_1',
          userId: 'dusr_001',
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it('uses DELIVERY_USER_JWT_SECRET and accepts active delivery users', async () => {
      prisma.deliveryUser.findUnique.mockResolvedValue({
        status: DeliveryUserStatus.ACTIVE,
      });
      const strategy = new DeliveryUserJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );
      const payload: DeliveryUserJwtPayload = {
        sub: 'dusr_001',
        type: 'delivery-user',
      };

      await expect(strategy.validate(payload)).resolves.toEqual({
        sub: 'dusr_001',
        deliveryUserId: 'dusr_001',
        type: 'delivery-user',
      });
      expect(configService.getOrThrow).toHaveBeenCalledWith('DELIVERY_USER_JWT_SECRET');
      expect(prisma.deliveryUser.findUnique).toHaveBeenCalledWith({
        where: { id: 'dusr_001' },
        select: { status: true },
      });
    });

    it('rejects non delivery-user payloads', async () => {
      const strategy = new DeliveryUserJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dusr_001',
          type: 'seller' as 'delivery-user',
        }),
      ).rejects.toThrow('无效的令牌类型');
      expect(prisma.deliveryUser.findUnique).not.toHaveBeenCalled();
    });

    it('rejects missing sub before DB lookup', async () => {
      const strategy = new DeliveryUserJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          type: 'delivery-user',
        } as DeliveryUserJwtPayload),
      ).rejects.toThrow('无效的令牌类型');
      expect(prisma.deliveryUser.findUnique).not.toHaveBeenCalled();
    });

    it('rejects missing delivery user records', async () => {
      prisma.deliveryUser.findUnique.mockResolvedValue(null);
      const strategy = new DeliveryUserJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dusr_001',
          type: 'delivery-user',
        }),
      ).rejects.toThrow('配送用户账号已被禁用');
      expect(prisma.deliveryUser.findUnique).toHaveBeenCalledTimes(1);
    });

    it('rejects inactive delivery user records', async () => {
      prisma.deliveryUser.findUnique.mockResolvedValue({
        status: DeliveryUserStatus.DISABLED,
      });
      const strategy = new DeliveryUserJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dusr_001',
          type: 'delivery-user',
        }),
      ).rejects.toThrow('配送用户账号已被禁用');
      expect(prisma.deliveryUser.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('DeliveryAdminJwtStrategy', () => {
    let prisma: {
      deliveryAdminSession: {
        findFirst: jest.Mock;
      };
      deliveryAdminUser: {
        findUnique: jest.Mock;
      };
    };

    beforeEach(() => {
      prisma = {
        deliveryAdminSession: {
          findFirst: jest.fn(),
        },
        deliveryAdminUser: {
          findUnique: jest.fn(),
        },
      };
    });

    it('uses DELIVERY_ADMIN_JWT_SECRET and accepts active delivery admins', async () => {
      prisma.deliveryAdminSession.findFirst.mockResolvedValue({
        id: 'dasess_001',
      });
      prisma.deliveryAdminUser.findUnique.mockResolvedValue({
        status: DeliveryAdminUserStatus.ACTIVE,
      });
      const strategy = new DeliveryAdminJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );
      const payload: DeliveryAdminJwtPayload = {
        sub: 'dadmin_001',
        sessionId: 'dasess_001',
        roles: ['ops'],
        permissions: ['delivery:manifest:review'],
        type: 'delivery-admin',
      };

      await expect(strategy.validate(payload)).resolves.toEqual({
        sub: 'dadmin_001',
        deliveryAdminUserId: 'dadmin_001',
        sessionId: 'dasess_001',
        roles: ['ops'],
        permissions: ['delivery:manifest:review'],
        type: 'delivery-admin',
      });
      expect(configService.getOrThrow).toHaveBeenCalledWith('DELIVERY_ADMIN_JWT_SECRET');
      expect(prisma.deliveryAdminSession.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'dasess_001',
          adminUserId: 'dadmin_001',
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        select: { id: true },
      });
      expect(prisma.deliveryAdminUser.findUnique).toHaveBeenCalledWith({
        where: { id: 'dadmin_001' },
        select: { status: true },
      });
    });

    it('rejects non delivery-admin payloads', async () => {
      const strategy = new DeliveryAdminJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dadmin_001',
          sessionId: 'dasess_001',
          roles: [],
          permissions: [],
          type: 'admin' as 'delivery-admin',
        }),
      ).rejects.toThrow('无效的令牌类型');
      expect(prisma.deliveryAdminSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.deliveryAdminUser.findUnique).not.toHaveBeenCalled();
    });

    it('rejects missing sub before DB lookup', async () => {
      const strategy = new DeliveryAdminJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          roles: [],
          permissions: [],
          type: 'delivery-admin',
        } as unknown as DeliveryAdminJwtPayload),
      ).rejects.toThrow('无效的令牌类型');
      expect(prisma.deliveryAdminSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.deliveryAdminUser.findUnique).not.toHaveBeenCalled();
    });

    it('rejects missing sessionId before DB lookup', async () => {
      const strategy = new DeliveryAdminJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dadmin_001',
          roles: [],
          permissions: [],
          type: 'delivery-admin',
        } as unknown as DeliveryAdminJwtPayload),
      ).rejects.toThrow('无效的令牌类型');
      expect(prisma.deliveryAdminSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.deliveryAdminUser.findUnique).not.toHaveBeenCalled();
    });

    it('rejects missing delivery admin records', async () => {
      prisma.deliveryAdminSession.findFirst.mockResolvedValue({
        id: 'dasess_001',
      });
      prisma.deliveryAdminUser.findUnique.mockResolvedValue(null);
      const strategy = new DeliveryAdminJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dadmin_001',
          sessionId: 'dasess_001',
          roles: [],
          permissions: [],
          type: 'delivery-admin',
        }),
      ).rejects.toThrow('配送管理账号已被禁用');
      expect(prisma.deliveryAdminUser.findUnique).toHaveBeenCalledTimes(1);
    });

    it('rejects inactive delivery admin records', async () => {
      prisma.deliveryAdminSession.findFirst.mockResolvedValue({
        id: 'dasess_001',
      });
      prisma.deliveryAdminUser.findUnique.mockResolvedValue({
        status: DeliveryAdminUserStatus.DISABLED,
      });
      const strategy = new DeliveryAdminJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dadmin_001',
          sessionId: 'dasess_001',
          roles: [],
          permissions: [],
          type: 'delivery-admin',
        }),
      ).rejects.toThrow('配送管理账号已被禁用');
      expect(prisma.deliveryAdminUser.findUnique).toHaveBeenCalledTimes(1);
    });

    it('rejects revoked or expired admin sessions before user lookup', async () => {
      prisma.deliveryAdminSession.findFirst.mockResolvedValue(null);
      const strategy = new DeliveryAdminJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dadmin_001',
          sessionId: 'dasess_001',
          roles: [],
          permissions: [],
          type: 'delivery-admin',
        }),
      ).rejects.toThrow('登录态已失效，请重新登录');
      expect(prisma.deliveryAdminUser.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('DeliverySellerJwtStrategy', () => {
    let prisma: {
      deliverySellerSession: {
        findFirst: jest.Mock;
      };
      deliverySellerStaff: {
        findUnique: jest.Mock;
      };
    };

    beforeEach(() => {
      prisma = {
        deliverySellerSession: {
          findFirst: jest.fn(),
        },
        deliverySellerStaff: {
          findUnique: jest.fn(),
        },
      };
    });

    it('uses DELIVERY_SELLER_JWT_SECRET and accepts active delivery seller staff', async () => {
      prisma.deliverySellerSession.findFirst.mockResolvedValue({
        id: 'dsess_001',
      });
      prisma.deliverySellerStaff.findUnique.mockResolvedValue({
        status: DeliverySellerStaffStatus.ACTIVE,
        merchantId: 'merchant_001',
      });
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );
      const payload: DeliverySellerJwtPayload = {
        sub: 'dstaff_001',
        sessionId: 'dsess_001',
        merchantId: 'merchant_001',
        role: DeliverySellerStaffRole.MANAGER,
        permissionCodes: ['delivery:orders:manage'],
        type: 'delivery-seller',
      };

      await expect(strategy.validate(payload)).resolves.toEqual({
        sub: 'dstaff_001',
        deliverySellerStaffId: 'dstaff_001',
        sessionId: 'dsess_001',
        merchantId: 'merchant_001',
        role: DeliverySellerStaffRole.MANAGER,
        permissionCodes: ['delivery:orders:manage'],
        type: 'delivery-seller',
      });
      expect(configService.getOrThrow).toHaveBeenCalledWith('DELIVERY_SELLER_JWT_SECRET');
      expect(prisma.deliverySellerSession.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'dsess_001',
          staffId: 'dstaff_001',
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        select: { id: true },
      });
      expect(prisma.deliverySellerStaff.findUnique).toHaveBeenCalledWith({
        where: { id: 'dstaff_001' },
        select: { status: true, merchantId: true },
      });
    });

    it('rejects non delivery-seller payloads', async () => {
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dstaff_001',
          sessionId: 'dsess_001',
          merchantId: 'merchant_001',
          role: DeliverySellerStaffRole.OWNER,
          permissionCodes: [],
          type: 'seller' as 'delivery-seller',
        }),
      ).rejects.toThrow('无效的令牌类型');
      expect(prisma.deliverySellerStaff.findUnique).not.toHaveBeenCalled();
    });

    it('rejects missing sub before DB lookup', async () => {
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          merchantId: 'merchant_001',
          role: DeliverySellerStaffRole.OWNER,
          permissionCodes: [],
          type: 'delivery-seller',
        } as unknown as DeliverySellerJwtPayload),
      ).rejects.toThrow('无效的令牌类型');
      expect(prisma.deliverySellerStaff.findUnique).not.toHaveBeenCalled();
    });

    it('rejects missing sessionId before DB lookup', async () => {
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dstaff_001',
          merchantId: 'merchant_001',
          role: DeliverySellerStaffRole.OWNER,
          permissionCodes: [],
          type: 'delivery-seller',
        } as unknown as DeliverySellerJwtPayload),
      ).rejects.toThrow('无效的令牌类型');
      expect(prisma.deliverySellerSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.deliverySellerStaff.findUnique).not.toHaveBeenCalled();
    });

    it('rejects missing merchantId before DB lookup', async () => {
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dstaff_001',
          sessionId: 'dsess_001',
          role: DeliverySellerStaffRole.OWNER,
          permissionCodes: [],
          type: 'delivery-seller',
        } as unknown as DeliverySellerJwtPayload),
      ).rejects.toThrow('无效的令牌类型');
      expect(prisma.deliverySellerStaff.findUnique).not.toHaveBeenCalled();
    });

    it('rejects missing seller role before DB lookup', async () => {
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dstaff_001',
          sessionId: 'dsess_001',
          merchantId: 'merchant_001',
          permissionCodes: [],
          type: 'delivery-seller',
        } as unknown as DeliverySellerJwtPayload),
      ).rejects.toThrow('无效的令牌类型');
      expect(prisma.deliverySellerStaff.findUnique).not.toHaveBeenCalled();
    });

    it('rejects invalid seller role before DB lookup', async () => {
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dstaff_001',
          sessionId: 'dsess_001',
          merchantId: 'merchant_001',
          role: 'INVALID_ROLE' as DeliverySellerStaffRole,
          permissionCodes: [],
          type: 'delivery-seller',
        }),
      ).rejects.toThrow('无效的卖家角色');
      expect(prisma.deliverySellerStaff.findUnique).not.toHaveBeenCalled();
    });

    it('rejects missing delivery seller records', async () => {
      prisma.deliverySellerSession.findFirst.mockResolvedValue({
        id: 'dsess_001',
      });
      prisma.deliverySellerStaff.findUnique.mockResolvedValue(null);
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dstaff_001',
          sessionId: 'dsess_001',
          merchantId: 'merchant_001',
          role: DeliverySellerStaffRole.OWNER,
          permissionCodes: [],
          type: 'delivery-seller',
        }),
      ).rejects.toThrow('配送中心账号已被禁用');
      expect(prisma.deliverySellerStaff.findUnique).toHaveBeenCalledTimes(1);
    });

    it('rejects inactive delivery seller records', async () => {
      prisma.deliverySellerSession.findFirst.mockResolvedValue({
        id: 'dsess_001',
      });
      prisma.deliverySellerStaff.findUnique.mockResolvedValue({
        status: DeliverySellerStaffStatus.DISABLED,
        merchantId: 'merchant_001',
      });
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dstaff_001',
          sessionId: 'dsess_001',
          merchantId: 'merchant_001',
          role: DeliverySellerStaffRole.OWNER,
          permissionCodes: [],
          type: 'delivery-seller',
        }),
      ).rejects.toThrow('配送中心账号已被禁用');
      expect(prisma.deliverySellerStaff.findUnique).toHaveBeenCalledTimes(1);
    });

    it('rejects seller merchant mismatch', async () => {
      prisma.deliverySellerSession.findFirst.mockResolvedValue({
        id: 'dsess_001',
      });
      prisma.deliverySellerStaff.findUnique.mockResolvedValue({
        status: DeliverySellerStaffStatus.ACTIVE,
        merchantId: 'merchant_002',
      });
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dstaff_001',
          sessionId: 'dsess_001',
          merchantId: 'merchant_001',
          role: DeliverySellerStaffRole.OWNER,
          permissionCodes: [],
          type: 'delivery-seller',
        }),
      ).rejects.toThrow('商家信息已变更，请重新登录');
      expect(prisma.deliverySellerStaff.findUnique).toHaveBeenCalledTimes(1);
    });

    it('rejects revoked or expired delivery seller sessions before staff lookup', async () => {
      prisma.deliverySellerSession.findFirst.mockResolvedValue(null);
      const strategy = new DeliverySellerJwtStrategy(
        configService as unknown as ConfigService,
        prisma as unknown as DeliveryPrismaService,
      );

      await expect(
        strategy.validate({
          sub: 'dstaff_001',
          sessionId: 'dsess_001',
          merchantId: 'merchant_001',
          role: DeliverySellerStaffRole.OWNER,
          permissionCodes: [],
          type: 'delivery-seller',
        }),
      ).rejects.toThrow('登录态已失效，请重新登录');
      expect(prisma.deliverySellerStaff.findUnique).not.toHaveBeenCalled();
    });
  });
});
