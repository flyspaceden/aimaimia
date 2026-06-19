import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

jest.mock('../../captcha/captcha.service', () => ({
  CaptchaService: class {},
}));

import { DeliverySellerAuthController } from '../seller-auth/delivery-seller-auth.controller';
import { DeliveryAdminManifestsController } from '../manifests/delivery-admin-manifests.controller';
import { DeliveryManifestsController } from '../manifests/delivery-manifests.controller';
import { DeliverySellerManifestsController } from '../manifests/delivery-seller-manifests.controller';

function isPublic(target: Function) {
  return Reflect.getMetadata(IS_PUBLIC_KEY, target) === true;
}

describe('delivery controllers that use delivery-specific guards', () => {
  it('marks delivery seller authenticated routes public for the global main JWT guard', () => {
    const prototype = DeliverySellerAuthController.prototype;

    expect(isPublic(prototype.logout)).toBe(true);
    expect(isPublic(prototype.getMe)).toBe(true);
    expect(isPublic(prototype.changePassword)).toBe(true);
    expect(isPublic(prototype.sendBindPhoneSmsCode)).toBe(true);
    expect(isPublic(prototype.changePhone)).toBe(true);
    expect(isPublic(prototype.changeNickname)).toBe(true);
  });

  it('marks manifest controllers public while retaining delivery-specific guards', () => {
    expect(isPublic(DeliveryManifestsController)).toBe(true);
    expect(isPublic(DeliveryAdminManifestsController)).toBe(true);
    expect(isPublic(DeliverySellerManifestsController)).toBe(true);
  });
});
