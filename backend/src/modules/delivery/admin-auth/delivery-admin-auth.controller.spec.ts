import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminAuthController } from './delivery-admin-auth.controller';

jest.mock('../../captcha/captcha.service', () => ({
  CaptchaService: class {},
}));

describe('DeliveryAdminAuthController', () => {
  it('delegates profile lookup to the delivery admin auth service', async () => {
    const authService = {
      getProfile: jest.fn().mockResolvedValue({
        id: 'dadmin_1',
        username: 'delivery-admin',
      }),
    };
    const captchaService = {
      generate: jest.fn(),
    };
    const controller = new DeliveryAdminAuthController(authService as any, captchaService as any);

    await expect(controller.getProfile('dadmin_1')).resolves.toEqual({
      id: 'dadmin_1',
      username: 'delivery-admin',
    });
    expect(authService.getProfile).toHaveBeenCalledWith('dadmin_1');
  });

  it('uses delivery admin guard on authenticated routes while bypassing the global main JWT guard', () => {
    const prototype = DeliveryAdminAuthController.prototype;

    for (const handler of [
      prototype.logout,
      prototype.getProfile,
      prototype.changePassword,
      prototype.sendBindPhoneSmsCode,
      prototype.changePhone,
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(DeliveryAdminAuthGuard);
    }
  });
});
