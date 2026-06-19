import { JwtService } from '@nestjs/jwt';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryBuyerAuthService } from './delivery-buyer-auth.service';
import { DeliveryPhoneOtpService } from './delivery-phone-otp.service';

describe('DeliveryBuyerAuthService', () => {
  let tx: any;
  let deliveryPrisma: { $transaction: jest.Mock; deliveryUser: { findUnique: jest.Mock } };
  let jwtService: { signAsync: jest.Mock };
  let idService: { next: jest.Mock };
  let otpService: { verifyPhoneLoginCode: jest.Mock };
  let service: DeliveryBuyerAuthService;

  beforeEach(() => {
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
    service = new DeliveryBuyerAuthService(
      deliveryPrisma as unknown as DeliveryPrismaService,
      jwtService as unknown as JwtService,
      idService as unknown as DeliveryIdService,
      otpService as unknown as DeliveryPhoneOtpService,
    );
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
      }),
    ).resolves.toMatchObject({
      accessToken: 'delivery-user-token',
      requiresUnit: true,
      user: {
        id: 'PSYH0000000000001',
        phone: '13800000000',
      },
    });

    expect(otpService.verifyPhoneLoginCode).toHaveBeenCalledWith('13800000000', '123456');
    expect(idService.next).toHaveBeenCalledWith('PSYH');
    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('wechat login creates an independent delivery auth identity', async () => {
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
        openid: 'wx-openid-1',
        unionid: 'wx-union-1',
        nickname: '微信配送用户',
        avatarUrl: 'https://example.com/avatar.png',
      }),
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
        providerSubject: 'wx-openid-1',
        phone: null,
      },
    });
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
