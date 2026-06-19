import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AliyunSmsService } from '../../../common/sms/aliyun-sms.service';
import { DeliveryAdminUserStatus } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { CaptchaService } from '../../captcha/captcha.service';
import { DeliveryAdminAuthService } from './delivery-admin-auth.service';

jest.mock('../../captcha/captcha.service', () => ({
  CaptchaService: class {},
}));

describe('DeliveryAdminAuthService', () => {
  let service: DeliveryAdminAuthService;
  let prisma: {
    deliveryAdminUser: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    deliveryPhoneOtp: {
      count: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    deliveryAdminSession: {
      create: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwtService: {
    sign: jest.Mock;
  };
  let configService: {
    get: jest.Mock;
    getOrThrow: jest.Mock;
  };
  let captchaService: {
    verify: jest.Mock;
    generate: jest.Mock;
  };
  let smsService: {
    sendVerificationCode: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      deliveryAdminUser: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      deliveryPhoneOtp: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      deliveryAdminSession: {
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('delivery-admin-access-token'),
    };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'DELIVERY_ADMIN_JWT_SECRET') return 'delivery-admin-secret';
        throw new Error(`unexpected getOrThrow ${key}`);
      }),
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'DELIVERY_ADMIN_JWT_EXPIRES_IN') return '8h';
        if (key === 'DELIVERY_SMS_MOCK') return 'true';
        return fallback;
      }),
    };
    captchaService = {
      verify: jest.fn().mockResolvedValue(true),
      generate: jest.fn(),
    };
    smsService = {
      sendVerificationCode: jest.fn().mockResolvedValue(undefined),
    };

    service = new DeliveryAdminAuthService(
      prisma as unknown as DeliveryPrismaService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      captchaService as unknown as CaptchaService,
      smsService as unknown as AliyunSmsService,
    );
  });

  it('issues delivery-admin tokens for a valid password login', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    prisma.deliveryAdminUser.findUnique.mockResolvedValue({
      id: 'dadmin_1',
      username: 'delivery-admin',
      phone: '13800000000',
      passwordHash,
      realName: '配送管理员',
      roleCodes: ['SUPER_ADMIN'],
      permissions: ['delivery:*'],
      status: DeliveryAdminUserStatus.ACTIVE,
      lastLoginAt: null,
      lastLoginIp: null,
    });
    prisma.deliveryAdminUser.update.mockResolvedValue({});
    prisma.deliveryAdminSession.create.mockResolvedValue({
      id: 'dasess_1',
    });

    await expect(
      service.login(
        {
          username: 'delivery-admin',
          password: 'correct-password',
          captchaId: 'captcha_1',
          captchaCode: 'abcd',
        },
        '127.0.0.1',
        'jest',
      ),
    ).resolves.toEqual({
      accessToken: 'delivery-admin-access-token',
      refreshToken: expect.any(String),
      expiresIn: '8h',
      admin: {
        id: 'dadmin_1',
        username: 'delivery-admin',
        realName: '配送管理员',
        roles: ['超级管理员'],
      },
    });

    expect(captchaService.verify).toHaveBeenCalledWith('captcha_1', 'abcd');
    expect(prisma.deliveryAdminSession.create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'dadmin_1',
        refreshTokenHash: expect.any(String),
        ip: '127.0.0.1',
        userAgent: 'jest',
        expiresAt: expect.any(Date),
      },
    });
    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        sub: 'dadmin_1',
        sessionId: 'dasess_1',
        roles: ['超级管理员'],
        permissions: ['delivery:*'],
        type: 'delivery-admin',
      },
      {
        secret: 'delivery-admin-secret',
        expiresIn: '8h',
      },
    );
  });

  it('refreshes tokens through delivery admin sessions only', async () => {
    prisma.deliveryAdminSession.findFirst.mockResolvedValue({
      id: 'dasess_1',
      ip: '127.0.0.1',
      userAgent: 'jest',
      adminUser: {
        id: 'dadmin_1',
        username: 'delivery-admin',
        realName: '配送管理员',
        roleCodes: ['SUPER_ADMIN'],
        permissions: ['delivery:*'],
        status: DeliveryAdminUserStatus.ACTIVE,
      },
    });
    prisma.deliveryAdminSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.deliveryAdminSession.create.mockResolvedValue({
      id: 'dasess_2',
    });

    await expect(service.refresh({ refreshToken: 'refresh-token' })).resolves.toMatchObject({
      accessToken: 'delivery-admin-access-token',
      refreshToken: expect.any(String),
      admin: {
        id: 'dadmin_1',
        roles: ['超级管理员'],
      },
    });

    expect(prisma.deliveryAdminSession.findFirst).toHaveBeenCalledWith({
      where: {
        refreshTokenHash: expect.any(String),
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      include: {
        adminUser: true,
      },
    });
    expect(prisma.deliveryAdminSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'dasess_1',
        refreshTokenHash: expect.any(String),
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });
    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        sub: 'dadmin_1',
        sessionId: 'dasess_2',
        roles: ['超级管理员'],
        permissions: ['delivery:*'],
        type: 'delivery-admin',
      },
      {
        secret: 'delivery-admin-secret',
        expiresIn: '8h',
      },
    );
  });

  it('revokes active admin sessions on logout and password change', async () => {
    prisma.deliveryAdminSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.deliveryAdminUser.findUnique.mockResolvedValue({
      id: 'dadmin_1',
      username: 'delivery-admin',
      phone: '13800000000',
      passwordHash: await bcrypt.hash('correct-password', 4),
      realName: '配送管理员',
      roleCodes: ['SUPER_ADMIN'],
      permissions: ['delivery:*'],
      status: DeliveryAdminUserStatus.ACTIVE,
      lastLoginAt: null,
      lastLoginIp: null,
    });
    prisma.deliveryAdminUser.update.mockResolvedValue({});

    await expect(service.logout('dadmin_1')).resolves.toEqual({ ok: true });
    expect(prisma.deliveryAdminSession.updateMany).toHaveBeenCalledWith({
      where: {
        adminUserId: 'dadmin_1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });

    await expect(
      service.changePassword('dadmin_1', {
        oldPassword: 'correct-password',
        newPassword: 'better-password',
      }),
    ).resolves.toEqual({ ok: true });
    expect(prisma.deliveryAdminSession.updateMany).toHaveBeenCalledTimes(2);
  });
});
