import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DeliveryPrismaModule } from '../../delivery-prisma/delivery-prisma.module';
import { DeliveryAuthModule } from './auth/delivery-auth.module';
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

@Module({
  imports: [
    DeliveryPrismaModule,
    DeliveryAuthModule,
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
  ],
  providers: [
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
  ],
  exports: [DeliveryIdService, DeliveryAuthModule, DeliveryPricingService],
})
export class DeliveryModule {}
