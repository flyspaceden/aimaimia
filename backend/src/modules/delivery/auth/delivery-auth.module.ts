import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DeliveryPrismaModule } from '../../../delivery-prisma/delivery-prisma.module';
import { DeliveryAdminJwtStrategy } from './delivery-admin-jwt.strategy';
import { DeliverySellerJwtStrategy } from './delivery-seller-jwt.strategy';
import { DeliveryUserJwtStrategy } from './delivery-user-jwt.strategy';
import { DeliveryAdminAuthGuard } from './guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from './guards/delivery-admin-permission.guard';
import { DeliverySellerAuthGuard } from './guards/delivery-seller-auth.guard';
import { DeliverySellerPermissionGuard } from './guards/delivery-seller-permission.guard';
import { DeliveryUserAuthGuard } from './guards/delivery-user-auth.guard';

@Module({
  imports: [PassportModule, DeliveryPrismaModule],
  providers: [
    DeliveryUserJwtStrategy,
    DeliveryAdminJwtStrategy,
    DeliverySellerJwtStrategy,
    DeliveryUserAuthGuard,
    DeliveryAdminAuthGuard,
    DeliveryAdminPermissionGuard,
    DeliverySellerAuthGuard,
    DeliverySellerPermissionGuard,
  ],
  exports: [
    DeliveryUserAuthGuard,
    DeliveryAdminAuthGuard,
    DeliveryAdminPermissionGuard,
    DeliverySellerAuthGuard,
    DeliverySellerPermissionGuard,
  ],
})
export class DeliveryAuthModule {}
