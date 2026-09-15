import { Module } from '@nestjs/common';
import {
  PickupAdminOrderController,
  PickupAdminPointController,
  PickupAdminVerificationController,
} from './pickup-admin.controller';
import {
  PickupSellerOrderController,
  PickupSellerPointController,
  PickupSellerVerificationController,
} from './pickup-seller.controller';
import { PickupService } from './pickup.service';
import { NotificationModule } from '../notification/notification.module';
import { ShipmentModule } from '../shipment/shipment.module';

@Module({
  imports: [NotificationModule, ShipmentModule],
  controllers: [
    PickupSellerPointController,
    PickupSellerOrderController,
    PickupSellerVerificationController,
    PickupAdminPointController,
    PickupAdminOrderController,
    PickupAdminVerificationController,
  ],
  providers: [PickupService],
  exports: [PickupService],
})
export class PickupModule {}
