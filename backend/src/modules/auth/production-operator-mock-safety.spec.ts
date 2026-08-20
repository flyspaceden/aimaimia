import { ServiceUnavailableException } from '@nestjs/common';
import { AdminAuthService } from '../admin/auth/admin-auth.service';
import { SellerAuthService } from '../seller/auth/seller-auth.service';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'ADMIN_JWT_SECRET' || key === 'SELLER_JWT_SECRET') return 'test-secret';
      throw new Error(`missing ${key}`);
    }),
  };
}

describe('production operator authentication mock safety', () => {
  it.each([undefined, 'true'])(
    'Admin SMS fails closed in production when SMS_MOCK=%p before writing an OTP',
    async (smsMock) => {
      const create = jest.fn();
      const prisma = {
        adminUser: { findUnique: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn(async (callback: any) => callback({
          smsOtp: { count: jest.fn().mockResolvedValue(0), create },
        })),
      };
      const service = new AdminAuthService(
        prisma as any,
        {} as any,
        config({ NODE_ENV: 'production', SMS_MOCK: smsMock }) as any,
        {} as any,
        { sendVerificationCode: jest.fn() } as any,
      );

      await expect(service.sendBindPhoneSmsCode({ phone: '13800000000' }, 'admin-1'))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('Admin never accepts a persisted fixed code while production mock configuration is unsafe', async () => {
    const prisma = {
      smsOtp: { findMany: jest.fn() },
    };
    const service = new AdminAuthService(
      prisma as any,
      {} as any,
      config({ NODE_ENV: 'production', SMS_MOCK: 'true' }) as any,
      {} as any,
      { sendVerificationCode: jest.fn() } as any,
    );

    await expect(service.loginByPhoneCode({ phone: '13800000000', code: '123456' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.smsOtp.findMany).not.toHaveBeenCalled();
  });

  it('Admin real SMS failure invalidates the persisted OTP and returns an error', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      adminUser: { findUnique: jest.fn().mockResolvedValue(null) },
      smsOtp: { updateMany },
      $transaction: jest.fn(async (callback: any) => callback({
        smsOtp: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
        },
      })),
    };
    const service = new AdminAuthService(
      prisma as any,
      {} as any,
      config({ NODE_ENV: 'production', SMS_MOCK: 'false' }) as any,
      {} as any,
      { sendVerificationCode: jest.fn().mockRejectedValue(new Error('provider down')) } as any,
    );

    await expect(service.sendBindPhoneSmsCode({ phone: '13800000000' }, 'admin-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ phone: '13800000000', purpose: 'BIND', usedAt: null }),
      data: { usedAt: expect.any(Date) },
    }));
  });

  it.each([undefined, 'true'])(
    'Seller SMS fails closed in production when SMS_MOCK=%p before writing an OTP',
    async (smsMock) => {
      const create = jest.fn();
      const prisma = {
        $transaction: jest.fn(async (callback: any) => callback({
          smsOtp: { count: jest.fn().mockResolvedValue(0), create },
        })),
      };
      const redis = { consumeFixedWindow: jest.fn().mockResolvedValue({ allowed: true }) };
      const service = new SellerAuthService(
        prisma as any,
        {} as any,
        config({ NODE_ENV: 'production', SMS_MOCK: smsMock }) as any,
        redis as any,
        {} as any,
        { sendVerificationCode: jest.fn() } as any,
        {} as any,
      );

      await expect(service.sendSmsCode({ phone: '13800000000' }))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(redis.consumeFixedWindow).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('Seller real SMS failure invalidates the persisted OTP and returns an error', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      smsOtp: { updateMany },
      $transaction: jest.fn(async (callback: any) => callback({
        smsOtp: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'otp-1' }) },
      })),
    };
    const redis = { consumeFixedWindow: jest.fn().mockResolvedValue(null) };
    const sms = { sendVerificationCode: jest.fn().mockRejectedValue(new Error('provider down')) };
    const service = new SellerAuthService(
      prisma as any,
      {} as any,
      config({ NODE_ENV: 'production', SMS_MOCK: 'false' }) as any,
      redis as any,
      {} as any,
      sms as any,
      {} as any,
    );

    await expect(service.sendSmsCode({ phone: '13800000000' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ phone: '13800000000', purpose: 'LOGIN', usedAt: null }),
      data: { usedAt: expect.any(Date) },
    }));
  });
});
