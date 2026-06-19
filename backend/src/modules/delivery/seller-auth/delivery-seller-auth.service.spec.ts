import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AliyunSmsService } from '../../../common/sms/aliyun-sms.service';
import { DeliverySellerStaffRole, DeliverySellerStaffStatus } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySellerAuthService } from './delivery-seller-auth.service';

describe('DeliverySellerAuthService', () => {
  let service: DeliverySellerAuthService;
  let prisma: {
    deliveryPhoneOtp: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
    };
    deliverySellerStaff: {
      findMany: jest.Mock;
    };
    deliverySellerSession: {
      create: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwtService: {
    sign: jest.Mock;
    verify: jest.Mock;
  };
  let configService: {
    getOrThrow: jest.Mock;
    get: jest.Mock;
  };
  let smsService: {
    sendVerificationCode: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      deliveryPhoneOtp: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      deliverySellerStaff: {
        findMany: jest.fn(),
      },
      deliverySellerSession: {
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    jwtService = {
      sign: jest.fn((payload: { type?: string }) =>
        payload.type === 'delivery-seller-temp' ? 'temp-token' : 'access-token',
      ),
      verify: jest.fn(),
    };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'DELIVERY_SELLER_JWT_SECRET') return 'delivery-seller-secret';
        throw new Error(`unexpected getOrThrow ${key}`);
      }),
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'DELIVERY_SELLER_JWT_EXPIRES_IN') return '8h';
        if (key === 'DELIVERY_SMS_MOCK') return 'true';
        return fallback;
      }),
    };
    smsService = {
      sendVerificationCode: jest.fn().mockResolvedValue(undefined),
    };

    service = new DeliverySellerAuthService(
      prisma as unknown as DeliveryPrismaService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      smsService as unknown as AliyunSmsService,
    );
  });

  it('returns company selection when sms login phone maps to multiple active delivery merchants', async () => {
    prisma.deliveryPhoneOtp.findFirst.mockResolvedValue({
      id: 'otp_login_1',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.deliveryPhoneOtp.updateMany.mockResolvedValue({ count: 1 });
    prisma.deliverySellerStaff.findMany.mockResolvedValue([
      {
        id: 'staff_1',
        merchantId: 'merchant_1',
        phone: '13800001001',
        realName: '陈澄源',
        role: DeliverySellerStaffRole.OWNER,
        permissionCodes: ['delivery:orders:manage'],
        status: DeliverySellerStaffStatus.ACTIVE,
        merchant: {
          id: 'merchant_1',
          name: '澄源生态',
          shortName: '澄源',
          status: 'ACTIVE',
        },
      },
      {
        id: 'staff_2',
        merchantId: 'merchant_2',
        phone: '13800001001',
        realName: '陈澄源',
        role: DeliverySellerStaffRole.MANAGER,
        permissionCodes: ['delivery:inventory:manage'],
        status: DeliverySellerStaffStatus.ACTIVE,
        merchant: {
          id: 'merchant_2',
          name: '青禾智慧',
          shortName: '青禾',
          status: 'ACTIVE',
        },
      },
    ]);

    await expect(
      service.login({ phone: '13800001001', code: '123456' }, '127.0.0.1', 'jest'),
    ).resolves.toEqual({
      needSelectCompany: true,
      tempToken: 'temp-token',
      companies: [
        {
          companyId: 'merchant_1',
          companyName: '澄源生态',
          shortName: '澄源',
          role: DeliverySellerStaffRole.OWNER,
          status: 'ACTIVE',
        },
        {
          companyId: 'merchant_2',
          companyName: '青禾智慧',
          shortName: '青禾',
          role: DeliverySellerStaffRole.MANAGER,
          status: 'ACTIVE',
        },
      ],
    });
  });

  it('logs password login into the staff whose password hash matches', async () => {
    const otherHash = await bcrypt.hash('other-password', 4);
    const matchedHash = await bcrypt.hash('good-password', 4);
    prisma.deliverySellerStaff.findMany.mockResolvedValue([
      {
        id: 'staff_1',
        merchantId: 'merchant_1',
        phone: '13800001002',
        realName: '李青禾',
        role: DeliverySellerStaffRole.OWNER,
        permissionCodes: ['delivery:company:manage'],
        status: DeliverySellerStaffStatus.ACTIVE,
        passwordHash: otherHash,
        merchant: {
          id: 'merchant_1',
          name: '澄源生态',
          shortName: '澄源',
          status: 'ACTIVE',
        },
      },
      {
        id: 'staff_2',
        merchantId: 'merchant_2',
        phone: '13800001002',
        realName: '李青禾',
        role: DeliverySellerStaffRole.MANAGER,
        permissionCodes: ['delivery:inventory:manage'],
        status: DeliverySellerStaffStatus.ACTIVE,
        passwordHash: matchedHash,
        merchant: {
          id: 'merchant_2',
          name: '青禾智慧',
          shortName: '青禾',
          status: 'ACTIVE',
        },
      },
    ]);
    prisma.deliverySellerSession.create.mockResolvedValue({
      id: 'dsess_new',
    });

    const result = await service.loginByPassword(
      {
        phone: '13800001002',
        password: 'good-password',
        captchaId: 'captcha_1',
        captchaCode: 'ABCD',
      },
      '127.0.0.1',
      'jest',
    );

    expect(result).toMatchObject({
      accessToken: 'access-token',
      expiresIn: '8h',
      seller: {
        staffId: 'staff_2',
        companyId: 'merchant_2',
        companyName: '青禾智慧',
        role: DeliverySellerStaffRole.MANAGER,
      },
    });
    expect(prisma.deliverySellerSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          staffId: 'staff_2',
        }),
      }),
    );
  });

  it('refresh rotates a revocable delivery seller session', async () => {
    prisma.deliverySellerSession.findFirst.mockResolvedValue({
      id: 'dsess_old',
      staffId: 'staff_1',
      refreshTokenHash: service.hashTokenForTest('refresh-old'),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      staff: {
        id: 'staff_1',
        merchantId: 'merchant_1',
        phone: '13800001001',
        realName: '陈澄源',
        role: DeliverySellerStaffRole.OWNER,
        permissionCodes: ['delivery:orders:manage'],
        status: DeliverySellerStaffStatus.ACTIVE,
        merchant: {
          id: 'merchant_1',
          name: '澄源生态',
          shortName: '澄源',
          status: 'ACTIVE',
        },
      },
    });
    prisma.deliverySellerSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.deliverySellerSession.create.mockResolvedValue({
      id: 'dsess_new',
    });

    const result = await service.refresh({ refreshToken: 'refresh-old' });

    expect(prisma.deliverySellerSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'dsess_old',
        refreshTokenHash: service.hashTokenForTest('refresh-old'),
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });
    expect(result).toMatchObject({
      accessToken: 'access-token',
      expiresIn: '8h',
      seller: {
        staffId: 'staff_1',
        companyId: 'merchant_1',
      },
    });
  });
});
