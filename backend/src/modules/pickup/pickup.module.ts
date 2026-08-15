import { Module } from '@nestjs/common';
import { PickupAdminOrderController, PickupAdminPointController } from './pickup-admin.controller';
import {
  PickupSellerOrderController,
  PickupSellerPointController,
  PickupSellerVerificationController,
} from './pickup-seller.controller';
import { PickupService } from './pickup.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [
    PickupSellerPointController,
    PickupSellerOrderController,
    PickupSellerVerificationController,
    PickupAdminPointController,
    PickupAdminOrderController,
  ],
  providers: [PickupService],
  exports: [PickupService],
})
export class PickupModule {}
