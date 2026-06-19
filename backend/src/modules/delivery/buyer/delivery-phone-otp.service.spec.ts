import { BadRequestException } from '@nestjs/common';
import { DeliveryPhoneOtpService } from './delivery-phone-otp.service';

describe('DeliveryPhoneOtpService', () => {
  const phone = '13800000000';

  it('valid stored OTP consumes and passes', async () => {
    const tx = {
      deliveryPhoneOtp: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'otp-1',
          phone,
          purpose: 'LOGIN',
          codeHash: 'expected-hash',
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const deliveryPrisma = {
      $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(tx)),
    };
    const configService = { get: jest.fn((key: string, fallback?: string) => fallback) };
    const service = new DeliveryPhoneOtpService(deliveryPrisma as any, configService as any);
    jest.spyOn(service, 'hashCode').mockReturnValue('expected-hash');

    await expect(service.verifyPhoneLoginCode(phone, '654321')).resolves.toBeUndefined();
    expect(tx.deliveryPhoneOtp.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phone,
          purpose: 'LOGIN',
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
  });

  it('missing or expired stored OTP rejects when mock env is unset', async () => {
    const missingTx = {
      deliveryPhoneOtp: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    };
    const expiredRecord = {
      id: 'otp-expired',
      phone,
      purpose: 'LOGIN',
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
    };
    const configService = { get: jest.fn((key: string, fallback?: string) => fallback) };
    const missingService = new DeliveryPhoneOtpService(
      { $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(missingTx)) } as any,
      configService as any,
    );
    const expiredService = new DeliveryPhoneOtpService(
      { $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(expiredTx)) } as any,
      configService as any,
    );
    jest.spyOn(missingService, 'hashCode').mockReturnValue('expected-hash');
    jest.spyOn(expiredService, 'hashCode').mockReturnValue('expected-hash');

    await expect(missingService.verifyPhoneLoginCode(phone, '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(expiredService.verifyPhoneLoginCode(phone, '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(missingTx.deliveryPhoneOtp.updateMany).not.toHaveBeenCalled();
    expect(expiredTx.deliveryPhoneOtp.updateMany).not.toHaveBeenCalled();
  });

  it('mock code passes only when explicit mock env is true', async () => {
    const serviceWithExplicitMock = new DeliveryPhoneOtpService(
      {
        $transaction: jest.fn(async () => null),
      } as any,
      {
        get: jest.fn((key: string, fallback?: string) => (key === 'DELIVERY_SMS_MOCK' ? 'true' : fallback)),
      } as any,
    );
    const serviceWithoutMock = new DeliveryPhoneOtpService(
      {
        $transaction: jest.fn(async () => null),
      } as any,
      {
        get: jest.fn((key: string, fallback?: string) => fallback),
      } as any,
    );

    await expect(serviceWithExplicitMock.verifyPhoneLoginCode(phone, '123456')).resolves.toBeUndefined();
    await expect(serviceWithoutMock.verifyPhoneLoginCode(phone, '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
