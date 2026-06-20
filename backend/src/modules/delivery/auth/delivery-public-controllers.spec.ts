import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

jest.mock('../../captcha/captcha.service', () => ({
  CaptchaService: class {},
}));

import { DeliverySellerAuthController } from '../seller-auth/delivery-seller-auth.controller';
import { DeliveryAdminManifestsController } from '../manifests/delivery-admin-manifests.controller';
import { DeliveryManifestsController } from '../manifests/delivery-manifests.controller';
import { DeliverySellerManifestsController } from '../manifests/delivery-seller-manifests.controller';
import { DELIVERY_SELLER_PERMISSIONS_KEY } from './decorators/require-delivery-seller-permission.decorator';
import { DeliverySellerCustomerServiceController } from '../customer-service/delivery-seller-customer-service.controller';
import { DeliverySellerInventoryController } from '../inventory/delivery-seller-inventory.controller';
import { DeliverySellerProductsController } from '../products/delivery-seller-products.controller';
import { DeliverySellerOpsController } from '../seller/delivery-seller-ops.controller';
import { DeliverySellerShippingController } from '../shipping/delivery-seller-shipping.controller';

function isPublic(target: Function) {
  return Reflect.getMetadata(IS_PUBLIC_KEY, target) === true;
}

function requiredSellerPermissions(target: Function) {
  return Reflect.getMetadata(DELIVERY_SELLER_PERMISSIONS_KEY, target);
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

  it('requires delivery seller permissions on active seller read/write controllers', () => {
    expect(requiredSellerPermissions(DeliverySellerOpsController.prototype.dashboard)).toEqual(['orders:read']);
    expect(requiredSellerPermissions(DeliverySellerOpsController.prototype.listOrders)).toEqual(['orders:read']);
    expect(requiredSellerPermissions(DeliverySellerOpsController.prototype.getOrder)).toEqual(['orders:read']);
    expect(requiredSellerPermissions(DeliverySellerOpsController.prototype.getCompany)).toEqual(['company:read']);
    expect(requiredSellerPermissions(DeliverySellerOpsController.prototype.updateCompany)).toEqual(['company:write']);
    expect(requiredSellerPermissions(DeliverySellerOpsController.prototype.listStaff)).toEqual(['staff:manage']);
    expect(requiredSellerPermissions(DeliverySellerOpsController.prototype.createStaff)).toEqual(['staff:manage']);
    expect(requiredSellerPermissions(DeliverySellerOpsController.prototype.updateStaff)).toEqual(['staff:manage']);

    expect(requiredSellerPermissions(DeliverySellerShippingController.prototype.ship)).toEqual(['orders:write']);
    expect(requiredSellerPermissions(DeliverySellerShippingController.prototype.listShipments)).toEqual(['orders:read']);

    expect(requiredSellerPermissions(DeliverySellerProductsController.prototype.list)).toEqual(['products:read']);
    expect(requiredSellerPermissions(DeliverySellerProductsController.prototype.getOne)).toEqual(['products:read']);
    expect(requiredSellerPermissions(DeliverySellerProductsController.prototype.create)).toEqual(['products:write']);
    expect(requiredSellerPermissions(DeliverySellerProductsController.prototype.update)).toEqual(['products:write']);
    expect(requiredSellerPermissions(DeliverySellerProductsController.prototype.submit)).toEqual(['products:write']);

    expect(requiredSellerPermissions(DeliverySellerInventoryController.prototype.updateStock)).toEqual(['inventory:write']);

    expect(requiredSellerPermissions(DeliverySellerCustomerServiceController.prototype.list)).toEqual(['customer-service:read']);
    expect(requiredSellerPermissions(DeliverySellerCustomerServiceController.prototype.get)).toEqual(['customer-service:read']);
    expect(requiredSellerPermissions(DeliverySellerCustomerServiceController.prototype.create)).toEqual(['customer-service:write']);
    expect(requiredSellerPermissions(DeliverySellerCustomerServiceController.prototype.update)).toEqual(['customer-service:write']);
  });
});
