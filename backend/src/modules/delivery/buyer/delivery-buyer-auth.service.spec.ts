import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { DeliveryUserStatus, Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryBuyerAuthService } from './delivery-buyer-auth.service';
import { DeliveryPhoneOtpService } from './delivery-phone-otp.service';

describe('DeliveryBuyerAuthService', () => {
  const originalFetch = global.fetch;
  let tx: any;
  let deliveryPrisma: {
    $transaction: jest.Mock;
    deliveryUser: { findUnique: jest.Mock };
    deliveryUserSession: { create: jest.Mock };
  };
  let jwtService: { signAsync: jest.Mock };
  let idService: { next: jest.Mock };
  let otpService: { verifyPhoneLoginCode: jest.Mock };
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let service: DeliveryBuyerAuthService;

  beforeEach(() => {
    global.fetch = jest.fn();
    tx = {
      deliveryAuthIdentity: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      deliveryUser: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      deliveryUnit: {
        findMany: jest.fn(),
      },
    };
    deliveryPrisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      deliveryUser: {
        findUnique: jest.fn(),
      },
      deliveryUserSession: {
        create: jest.fn(),
      },
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('delivery-user-token'),
    };
    idService = {
      next: jest.fn().mockResolvedValue('PSYH0000000000001'),
    };
    otpService = {
      verifyPhoneLoginCode: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'DELIVERY_WECHAT_MOCK') return 'true';
        return defaultValue;
      }),
      getOrThrow: jest.fn((key: string) => `value-for:${key}`),
    };
    service = new DeliveryBuyerAuthService(
      deliveryPrisma as unknown as DeliveryPrismaService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      idService as unknown as DeliveryIdService,
      otpService as unknown as DeliveryPhoneOtpService,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('phone OTP login creates a delivery user when no identity exists', async () => {
    tx.deliveryAuthIdentity.findUnique.mockResolvedValue(null);
    tx.deliveryUser.create.mockResolvedValue({
      id: 'PSYH0000000000001',
      phone: '13800000000',
      nickname: '配送新用户',
      avatarUrl: null,
      status: 'ACTIVE',
      currentUnitId: null,
    });
    deliveryPrisma.deliveryUserSession.create.mockResolvedValue({
      id: 'dusess_1',
    });
    tx.deliveryAuthIdentity.create.mockResolvedValue({ id: 'identity_1' });
    tx.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      phone: '13800000000',
      nickname: '配送新用户',
      avatarUrl: null,
      status: 'ACTIVE',
      currentUnitId: null,
      units: [],
      currentUnit: null,
    });

    await expect(
      service.phoneLogin({
        phone: '13800000000',
        code: '123456',
        nickname: '配送新用户',
      }, '127.0.0.1', 'jest-phone'),
    ).resolves.toMatchObject({
      accessToken: 'delivery-user-token',
      requiresUnit: true,
      user: {
        id: 'PSYH0000000000001',
        phone: '13800000000',
      },
    });

    expect(otpService.verifyPhoneLoginCode).toHaveBeenCalledWith('13800000000', '123456', {
      ip: '127.0.0.1',
      userAgent: 'jest-phone',
    });
    expect(idService.next).toHaveBeenCalledWith('PSYH');
    expect(deliveryPrisma.deliveryUserSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'PSYH0000000000001',
        loginMethod: 'PHONE',
        ip: '127.0.0.1',
        userAgent: 'jest-phone',
      }),
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 'PSYH0000000000001',
      type: 'delivery-user',
      sessionId: 'dusess_1',
    });
    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('wechat login creates an independent delivery auth identity from server-side code exchange', async () => {
    const code = 'delivery-wechat-code-1';
    configService.get.mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'DELIVERY_WECHAT_MOCK') return undefined;
      if (key === 'WECHAT_MOCK') return 'true';
      if (key === 'WECHAT_APP_ID') return 'delivery-app-id';
      if (key === 'WECHAT_APP_SECRET') return 'delivery-app-secret';
      return defaultValue;
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        openid: 'wx-server-openid',
        unionid: 'wx-server-unionid',
      }),
    });
    tx.deliveryAuthIdentity.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.deliveryUser.create.mockResolvedValue({
      id: 'PSYH0000000000001',
      phone: null,
      nickname: '微信配送用户',
      avatarUrl: 'https://example.com/avatar.png',
      status: 'ACTIVE',
      currentUnitId: null,
    });
    deliveryPrisma.deliveryUserSession.create.mockResolvedValue({
      id: 'dusess_wx_1',
    });
    tx.deliveryAuthIdentity.create.mockResolvedValue({ id: 'identity_2' });
    tx.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      phone: null,
      nickname: '微信配送用户',
      avatarUrl: 'https://example.com/avatar.png',
      status: 'ACTIVE',
      currentUnitId: null,
      units: [],
      currentUnit: null,
    });

    await expect(
      service.wechatLogin({
        code,
        nickname: '微信配送用户',
        avatarUrl: 'https://example.com/avatar.png',
      }, '127.0.0.2', 'jest-wechat'),
    ).resolves.toMatchObject({
      accessToken: 'delivery-user-token',
      requiresUnit: true,
      user: {
        id: 'PSYH0000000000001',
      },
    });

    expect(tx.deliveryAuthIdentity.create).toHaveBeenCalledWith({
      data: {
        userId: 'PSYH0000000000001',
        provider: 'WECHAT',
        providerSubject: 'wx-server-openid',
        phone: null,
      },
    });
    expect(deliveryPrisma.deliveryUserSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'PSYH0000000000001',
        loginMethod: 'WECHAT',
        ip: '127.0.0.2',
        userAgent: 'jest-wechat',
      }),
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 'PSYH0000000000001',
      type: 'delivery-user',
      sessionId: 'dusess_wx_1',
    });
    expect(global.fetch).toHaveBeenCalled();
  });

  it('wechat login still supports explicit delivery-scoped mock mode', async () => {
    const code = 'delivery-wechat-code-mock';
    const derivedOpenId = createHash('sha256')
      .update(`wx_openid_${code}`)
      .digest('hex')
      .slice(0, 28);
    configService.get.mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'DELIVERY_WECHAT_MOCK') return 'true';
      return defaultValue;
    });
    tx.deliveryAuthIdentity.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.deliveryUser.create.mockResolvedValue({
      id: 'PSYH0000000000001',
      phone: null,
      nickname: '微信配送用户',
      avatarUrl: null,
      status: 'ACTIVE',
      currentUnitId: null,
    });
    deliveryPrisma.deliveryUserSession.create.mockResolvedValue({
      id: 'dusess_wx_mock',
    });
    tx.deliveryAuthIdentity.create.mockResolvedValue({ id: 'identity_2' });
    tx.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      phone: null,
      nickname: '微信配送用户',
      avatarUrl: null,
      status: 'ACTIVE',
      currentUnitId: null,
      units: [],
      currentUnit: null,
    });

    await expect(
      service.wechatLogin({
        code,
        nickname: '微信配送用户',
      }, '127.0.0.3', 'jest-wechat-mock'),
    ).resolves.toMatchObject({
      accessToken: 'delivery-user-token',
      user: {
        id: 'PSYH0000000000001',
      },
    });

    expect(tx.deliveryAuthIdentity.create).toHaveBeenCalledWith({
      data: {
        userId: 'PSYH0000000000001',
        provider: 'WECHAT',
        providerSubject: derivedOpenId,
        phone: null,
      },
    });
    expect(deliveryPrisma.deliveryUserSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'PSYH0000000000001',
        loginMethod: 'WECHAT',
        ip: '127.0.0.3',
        userAgent: 'jest-wechat-mock',
      }),
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('wechat login does not merge into an existing phone identity', async () => {
    const code = 'delivery-wechat-code-2';
    const derivedOpenId = createHash('sha256')
      .update(`wx_openid_${code}`)
      .digest('hex')
      .slice(0, 28);
    tx.deliveryAuthIdentity.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        userId: 'PSYHPHONE00000001',
      });
    tx.deliveryUser.create.mockResolvedValue({
      id: 'PSYH0000000000001',
      phone: null,
      nickname: '微信配送用户',
      avatarUrl: null,
      status: 'ACTIVE',
      currentUnitId: null,
    });
    deliveryPrisma.deliveryUserSession.create.mockResolvedValue({
      id: 'dusess_wx_2',
    });
    tx.deliveryAuthIdentity.create.mockResolvedValue({ id: 'identity_3' });
    tx.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      phone: null,
      nickname: '微信配送用户',
      avatarUrl: null,
      status: 'ACTIVE',
      currentUnitId: null,
      units: [],
      currentUnit: null,
    });

    await expect(
      service.wechatLogin({
        code,
        nickname: '微信配送用户',
      }),
    ).resolves.toMatchObject({
      accessToken: 'delivery-user-token',
      user: {
        id: 'PSYH0000000000001',
        phone: null,
      },
    });

    expect(tx.deliveryAuthIdentity.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.deliveryAuthIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        provider_providerSubject: {
          provider: 'WECHAT',
          providerSubject: derivedOpenId,
        },
      },
    });
    expect(tx.deliveryUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'PSYH0000000000001',
        phone: null,
        nickname: '微信配送用户',
      }),
    });
    expect(tx.deliveryAuthIdentity.create).toHaveBeenCalledWith({
      data: {
        userId: 'PSYH0000000000001',
        provider: 'WECHAT',
        providerSubject: derivedOpenId,
        phone: null,
      },
    });
  });

  it.each([DeliveryUserStatus.DISABLED, DeliveryUserStatus.FROZEN])(
    'phone login rejects existing %s delivery users before mutation',
    async (status) => {
      tx.deliveryAuthIdentity.findUnique.mockResolvedValue({
        userId: 'PSYH0000000000099',
      });
      tx.deliveryUser.findUnique.mockResolvedValue({
        id: 'PSYH0000000000099',
        status,
      });

      await expect(
        service.phoneLogin({
          phone: '13800000000',
          code: '123456',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(tx.deliveryUser.update).not.toHaveBeenCalled();
      expect(tx.deliveryAuthIdentity.create).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    },
  );

  it.each([DeliveryUserStatus.DISABLED, DeliveryUserStatus.FROZEN])(
    'wechat login rejects existing %s delivery users before mutation',
    async (status) => {
      const code = `delivery-wechat-${status.toLowerCase()}`;
      const derivedOpenId = createHash('sha256')
        .update(`wx_openid_${code}`)
        .digest('hex')
        .slice(0, 28);
      tx.deliveryAuthIdentity.findUnique.mockResolvedValue({
        userId: 'PSYH0000000000088',
      });
      tx.deliveryUser.findUnique.mockResolvedValue({
        id: 'PSYH0000000000088',
        status,
      });

      await expect(
        service.wechatLogin({
          code,
          nickname: '冻结微信配送用户',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(tx.deliveryUser.update).not.toHaveBeenCalled();
      expect(tx.deliveryUser.create).not.toHaveBeenCalled();
      expect(tx.deliveryAuthIdentity.create).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(tx.deliveryAuthIdentity.findUnique).toHaveBeenCalledWith({
        where: {
          provider_providerSubject: {
            provider: 'WECHAT',
            providerSubject: derivedOpenId,
          },
        },
      });
    },
  );

  it('wechat login rejects failed server-side WeChat exchange in non-mock mode', async () => {
    configService.get.mockImplementation((key: string, defaultValue?: string) => {
      if (key === 'DELIVERY_WECHAT_MOCK') return 'false';
      if (key === 'WECHAT_MOCK') return 'false';
      return defaultValue;
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        errcode: 40029,
        errmsg: 'invalid code',
      }),
    });

    await expect(
      service.wechatLogin({
        code: 'bad-wechat-code',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.deliveryAuthIdentity.findUnique).not.toHaveBeenCalled();
    expect(tx.deliveryUser.create).not.toHaveBeenCalled();
    expect(tx.deliveryUser.update).not.toHaveBeenCalled();
  });

  it('getMe returns requiresUnit=true when the user has no units', async () => {
    deliveryPrisma.deliveryUser.findUnique.mockResolvedValue({
      id: 'PSYH0000000000001',
      phone: '13800000000',
      nickname: '配送新用户',
      avatarUrl: null,
      status: 'ACTIVE',
      currentUnitId: null,
      units: [],
      currentUnit: null,
    });

    await expect(service.getMe('PSYH0000000000001')).resolves.toMatchObject({
      requiresUnit: true,
      currentUnit: null,
      user: {
        id: 'PSYH0000000000001',
      },
    });
  });
});
