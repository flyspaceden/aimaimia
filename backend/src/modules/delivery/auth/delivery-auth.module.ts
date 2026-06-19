import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DeliveryPrismaModule } from '../../../delivery-prisma/delivery-prisma.module';
import { DeliveryAdminJwtStrategy } from './delivery-admin-jwt.strategy';
import { DeliverySellerJwtStrategy } from './delivery-seller-jwt.strategy';
import { DeliveryUserJwtStrategy } from './delivery-user-jwt.strategy';
import { DeliveryAdminAuthGuard } from './guards/delivery-admin-auth.guard';
import { DeliverySellerAuthGuard } from './guards/delivery-seller-auth.guard';
import { DeliveryUserAuthGuard } from './guards/delivery-user-auth.guard';

@Module({
  imports: [PassportModule, DeliveryPrismaModule],
  providers: [
    DeliveryUserJwtStrategy,
    DeliveryAdminJwtStrategy,
    DeliverySellerJwtStrategy,
    DeliveryUserAuthGuard,
    DeliveryAdminAuthGuard,
    DeliverySellerAuthGuard,
  ],
  exports: [DeliveryUserAuthGuard, DeliveryAdminAuthGuard, DeliverySellerAuthGuard],
})
export class DeliveryAuthModule {}
