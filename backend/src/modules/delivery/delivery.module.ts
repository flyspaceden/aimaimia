import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DeliveryPrismaModule } from '../../delivery-prisma/delivery-prisma.module';
import { DeliveryAuthModule } from './auth/delivery-auth.module';
import { CaptchaModule } from '../captcha/captcha.module';
import { ShipmentModule } from '../shipment/shipment.module';
import { UploadModule } from '../upload/upload.module';
import { DeliveryIdService } from './common/delivery-id.service';
import { DeliveryBuyerAuthController } from './buyer/delivery-buyer-auth.controller';
import { DeliveryBuyerAuthService } from './buyer/delivery-buyer-auth.service';
import { DeliveryPhoneOtpService } from './buyer/delivery-phone-otp.service';
import { DeliveryUnitsController } from './units/delivery-units.controller';
import { DeliveryUnitsService } from './units/delivery-units.service';
import { DeliverySellerApplicationController } from './seller-applications/delivery-seller-application.controller';
import { DeliverySellerApplicationService } from './seller-applications/delivery-seller-application.service';
import { UnitFieldConfigController } from './admin/unit-field-config.controller';
import { DeliveryUnitFieldConfigService } from './admin/unit-field-config.service';
import { DeliveryCatalogController } from './catalog/delivery-catalog.controller';
import { DeliveryCatalogService } from './catalog/delivery-catalog.service';
import { DeliveryAdminProductsController } from './products/delivery-admin-products.controller';
import { DeliverySellerProductsController } from './products/delivery-seller-products.controller';
import { DeliveryProductsService } from './products/delivery-products.service';
import { DeliveryPricingService } from './pricing/delivery-pricing.service';
import { DeliveryAdminPricingRulesController } from './pricing/delivery-admin-pricing-rules.controller';
import { DeliveryInventoryService } from './inventory/delivery-inventory.service';
import { DeliverySellerInventoryController } from './inventory/delivery-seller-inventory.controller';
import { DeliveryCartController } from './cart/delivery-cart.controller';
import { DeliveryCartService } from './cart/delivery-cart.service';
import { DeliveryCheckoutController } from './checkout/delivery-checkout.controller';
import { DeliveryCheckoutService } from './checkout/delivery-checkout.service';
import { DeliveryOrdersService } from './orders/delivery-orders.service';
import { DeliveryBuyerOrdersController } from './orders/delivery-buyer-orders.controller';
import { DeliveryPaymentsService } from './payments/delivery-payments.service';
import { DeliveryShippingService } from './shipping/delivery-shipping.service';
import { DeliverySellerShippingController } from './shipping/delivery-seller-shipping.controller';
import { DeliveryOrderShipmentsController } from './shipping/delivery-order-shipments.controller';
import { DeliveryAdminShippingRecordsController } from './shipping/delivery-admin-shipping-records.controller';
import { DeliveryManifestsController } from './manifests/delivery-manifests.controller';
import { DeliveryAdminManifestsController } from './manifests/delivery-admin-manifests.controller';
import { DeliverySellerManifestsController } from './manifests/delivery-seller-manifests.controller';
import { DeliveryManifestsService } from './manifests/delivery-manifests.service';
import { DeliverySettlementService } from './settlement/delivery-settlement.service';
import { DeliveryAdminSettlementController } from './settlement/delivery-admin-settlement.controller';
import { DeliverySellerSettlementController } from './settlement/delivery-seller-settlement.controller';
import { DeliveryCustomerServiceService } from './customer-service/delivery-customer-service.service';
import { DeliveryAdminCustomerServiceController } from './customer-service/delivery-admin-customer-service.controller';
import { DeliverySellerCustomerServiceController } from './customer-service/delivery-seller-customer-service.controller';
import { DeliveryConfigService } from './config/delivery-config.service';
import { DeliveryAdminConfigController } from './config/delivery-admin-config.controller';
import { DeliveryStatsService } from './stats/delivery-stats.service';
import { DeliveryAdminStatsController } from './stats/delivery-admin-stats.controller';
import { DeliveryAdminOpsService } from './admin/delivery-admin-ops.service';
import { DeliveryAdminOpsController } from './admin/delivery-admin-ops.controller';
import { DeliverySellerOpsService } from './seller/delivery-seller-ops.service';
import { DeliverySellerOpsController } from './seller/delivery-seller-ops.controller';
import { DeliverySellerPublicController } from './seller/delivery-seller-public.controller';
import { DeliverySellerPublicService } from './seller/delivery-seller-public.service';
import { DeliverySellerUploadController } from './seller/delivery-seller-upload.controller';
import { DeliverySellerAuthController } from './seller-auth/delivery-seller-auth.controller';
import { DeliverySellerAuthService } from './seller-auth/delivery-seller-auth.service';
import { DeliveryAdminAuthController } from './admin-auth/delivery-admin-auth.controller';
import { DeliveryAdminAuthService } from './admin-auth/delivery-admin-auth.service';

@Module({
  imports: [
    DeliveryPrismaModule,
    DeliveryAuthModule,
    CaptchaModule,
    ShipmentModule,
    UploadModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('DELIVERY_USER_JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('DELIVERY_USER_JWT_EXPIRES_IN', '8h') as any,
        },
      }),
    }),
  ],
  controllers: [
    DeliverySellerAuthController,
    DeliveryAdminAuthController,
    DeliveryBuyerAuthController,
    DeliveryUnitsController,
    DeliverySellerApplicationController,
    UnitFieldConfigController,
    DeliveryCatalogController,
    DeliveryAdminProductsController,
    DeliverySellerProductsController,
    DeliveryAdminPricingRulesController,
    DeliverySellerInventoryController,
    DeliveryCartController,
    DeliveryCheckoutController,
    DeliveryBuyerOrdersController,
    DeliverySellerShippingController,
    DeliveryOrderShipmentsController,
    DeliveryAdminShippingRecordsController,
    DeliveryManifestsController,
    DeliveryAdminManifestsController,
    DeliverySellerManifestsController,
    DeliveryAdminSettlementController,
    DeliverySellerSettlementController,
    DeliveryAdminCustomerServiceController,
    DeliverySellerCustomerServiceController,
    DeliveryAdminConfigController,
    DeliveryAdminStatsController,
    DeliveryAdminOpsController,
    DeliverySellerOpsController,
    DeliverySellerPublicController,
    DeliverySellerUploadController,
  ],
  providers: [
    DeliverySellerAuthService,
    DeliveryAdminAuthService,
    DeliveryIdService,
    DeliveryBuyerAuthService,
    DeliveryPhoneOtpService,
    DeliveryUnitsService,
    DeliverySellerApplicationService,
    DeliveryUnitFieldConfigService,
    DeliveryCatalogService,
    DeliveryProductsService,
    DeliveryPricingService,
    DeliveryInventoryService,
    DeliveryCartService,
    DeliveryCheckoutService,
    DeliveryOrdersService,
    DeliveryPaymentsService,
    DeliveryShippingService,
    DeliveryManifestsService,
    DeliverySettlementService,
    DeliveryCustomerServiceService,
    DeliveryConfigService,
    DeliveryStatsService,
    DeliveryAdminOpsService,
    DeliverySellerOpsService,
    DeliverySellerPublicService,
  ],
  exports: [
    DeliveryIdService,
    DeliveryAuthModule,
    DeliveryPricingService,
    DeliveryPaymentsService,
  ],
})
export class DeliveryModule {}
