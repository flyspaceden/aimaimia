import { BadRequestException } from '@nestjs/common';
import { DeliveryPhoneOtpService } from './delivery-phone-otp.service';

describe('DeliveryPhoneOtpService', () => {
  const phone = '13800000000';

  it('issues delivery-scoped login otp records and uses delivery sms mock code 123456 only when enabled', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'otp-create-1' });
    const count = jest.fn().mockResolvedValue(0);
    const smsService = { sendVerificationCode: jest.fn() };
    const service = new DeliveryPhoneOtpService(
      {
        deliveryPhoneOtp: {
          count,
          create,
        },
      } as any,
      {
        get: jest.fn((key: string, fallback?: string) => {
          if (key === 'DELIVERY_SMS_MOCK') return 'true';
          return fallback;
        }),
      } as any,
      smsService as any,
    );
    jest.spyOn(service, 'hashCode').mockReturnValue('mock-hash');

    await expect(
      service.issuePhoneLoginCode(phone, {
        ip: '127.0.0.5',
        userAgent: 'jest-send-otp',
      }),
    ).resolves.toEqual({ ok: true, message: '验证码已发送' });

    expect(count).toHaveBeenCalledWith({
      where: {
        phone,
        purpose: 'BUYER_LOGIN',
        createdAt: {
          gte: expect.any(Date),
        },
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone,
        purpose: 'BUYER_LOGIN',
        codeHash: 'mock-hash',
        expiresAt: expect.any(Date),
      }),
    });
    expect(smsService.sendVerificationCode).not.toHaveBeenCalled();
  });

  it('valid stored OTP consumes and passes', async () => {
    const tx = {
      deliveryPhoneOtp: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'otp-1',
          phone,
          purpose: 'BUYER_LOGIN',
          codeHash: 'expected-hash',
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      deliveryPhoneOtpAttempt: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
      },
    };
    const deliveryPrisma = {
      $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(tx)),
      deliveryPhoneOtpAttempt: {
        create: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
      },
    };
    const configService = { get: jest.fn((key: string, fallback?: string) => fallback) };
    const service = new DeliveryPhoneOtpService(
      deliveryPrisma as any,
      configService as any,
      { sendVerificationCode: jest.fn() } as any,
    );
    jest.spyOn(service, 'hashCode').mockReturnValue('expected-hash');

    await expect(
      (service as any).verifyPhoneLoginCode(phone, '654321', {
        ip: '127.0.0.1',
        userAgent: 'jest-otp',
      }),
    ).resolves.toBeUndefined();
    expect(tx.deliveryPhoneOtp.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phone,
          purpose: 'BUYER_LOGIN',
          codeHash: 'expected-hash',
          consumedAt: null,
        }),
      }),
    );
    expect(tx.deliveryPhoneOtp.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      }),
    );
    expect(deliveryPrisma.deliveryPhoneOtpAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone,
        purpose: 'BUYER_LOGIN',
        success: true,
        ip: '127.0.0.1',
        userAgent: 'jest-otp',
      }),
    });
  });

  it('missing or expired stored OTP rejects when mock env is unset', async () => {
    const missingTx = {
      deliveryPhoneOtp: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
      deliveryPhoneOtpAttempt: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const expiredRecord = {
      id: 'otp-expired',
      phone,
      purpose: 'BUYER_LOGIN',
      codeHash: 'expected-hash',
      consumedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(Date.now() - 120_000),
    };
    const expiredTx = {
      deliveryPhoneOtp: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.expiresAt?.gt instanceof Date && where.expiresAt.gt < expiredRecord.expiresAt) {
            return Promise.resolve(expiredRecord);
          }
          return Promise.resolve(null);
        }),
        updateMany: jest.fn(),
      },
      deliveryPhoneOtpAttempt: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const configService = { get: jest.fn((key: string, fallback?: string) => fallback) };
    const missingService = new DeliveryPhoneOtpService(
      {
        $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(missingTx)),
        deliveryPhoneOtpAttempt: {
          create: jest.fn().mockResolvedValue({ id: 'attempt-missing' }),
        },
      } as any,
      configService as any,
      { sendVerificationCode: jest.fn() } as any,
    );
    const expiredService = new DeliveryPhoneOtpService(
      {
        $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(expiredTx)),
        deliveryPhoneOtpAttempt: {
          create: jest.fn().mockResolvedValue({ id: 'attempt-expired' }),
        },
      } as any,
      configService as any,
      { sendVerificationCode: jest.fn() } as any,
    );
    jest.spyOn(missingService, 'hashCode').mockReturnValue('expected-hash');
    jest.spyOn(expiredService, 'hashCode').mockReturnValue('expected-hash');

    await expect(
      (missingService as any).verifyPhoneLoginCode(phone, '123456', {
        ip: '127.0.0.2',
        userAgent: 'missing-otp',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      (expiredService as any).verifyPhoneLoginCode(phone, '123456', {
        ip: '127.0.0.3',
        userAgent: 'expired-otp',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(missingTx.deliveryPhoneOtp.updateMany).not.toHaveBeenCalled();
    expect(expiredTx.deliveryPhoneOtp.updateMany).not.toHaveBeenCalled();
    expect((missingService as any).deliveryPrisma.deliveryPhoneOtpAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone,
        purpose: 'BUYER_LOGIN',
        success: false,
        ip: '127.0.0.2',
        userAgent: 'missing-otp',
      }),
    });
  });

  it('mock code passes only when explicit mock env is true', async () => {
    const serviceWithExplicitMock = new DeliveryPhoneOtpService(
      {
        $transaction: jest.fn(async () => null),
        deliveryPhoneOtpAttempt: {
          create: jest.fn(),
        },
        deliveryPhoneOtp: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(),
        },
      } as any,
      {
        get: jest.fn((key: string, fallback?: string) => (key === 'DELIVERY_SMS_MOCK' ? 'true' : fallback)),
      } as any,
      { sendVerificationCode: jest.fn() } as any,
    );
    const serviceWithoutMock = new DeliveryPhoneOtpService(
      {
        $transaction: jest.fn(async () => null),
        deliveryPhoneOtpAttempt: {
          create: jest.fn(),
        },
        deliveryPhoneOtp: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(),
        },
      } as any,
      {
        get: jest.fn((key: string, fallback?: string) => fallback),
      } as any,
      { sendVerificationCode: jest.fn() } as any,
    );

    await expect(serviceWithExplicitMock.verifyPhoneLoginCode(phone, '123456')).resolves.toBeUndefined();
    await expect(serviceWithoutMock.verifyPhoneLoginCode(phone, '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('blocks repeated failed verification attempts for the same phone and ip', async () => {
    const tx = {
      deliveryPhoneOtpAttempt: {
        count: jest.fn().mockResolvedValue(5),
        create: jest.fn(),
      },
      deliveryPhoneOtp: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const service = new DeliveryPhoneOtpService(
      {
        $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(tx)),
        deliveryPhoneOtpAttempt: {
          create: jest.fn(),
        },
        deliveryPhoneOtp: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn(),
        },
      } as any,
      {
        get: jest.fn((key: string, fallback?: string) => fallback),
      } as any,
      { sendVerificationCode: jest.fn() } as any,
    );

    await expect(
      (service as any).verifyPhoneLoginCode(phone, '123456', {
        ip: '127.0.0.9',
        userAgent: 'too-many-failures',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.deliveryPhoneOtp.findFirst).not.toHaveBeenCalled();
    expect(tx.deliveryPhoneOtpAttempt.create).not.toHaveBeenCalled();
  });

  it('rejects issuing login otp when the same delivery phone already requested one within a minute', async () => {
    const service = new DeliveryPhoneOtpService(
      {
        deliveryPhoneOtp: {
          count: jest.fn().mockResolvedValue(1),
          create: jest.fn(),
        },
      } as any,
      {
        get: jest.fn((key: string, fallback?: string) => fallback),
      } as any,
      { sendVerificationCode: jest.fn() } as any,
    );

    await expect(service.issuePhoneLoginCode(phone)).rejects.toBeInstanceOf(BadRequestException);
  });
});
