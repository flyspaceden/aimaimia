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
  ],
  providers: [
    DeliveryIdService,
    DeliveryBuyerAuthService,
    DeliveryPhoneOtpService,
    DeliveryUnitsService,
    DeliverySellerApplicationService,
    DeliveryUnitFieldConfigService,
  ],
  exports: [DeliveryIdService, DeliveryAuthModule],
})
export class DeliveryModule {}
