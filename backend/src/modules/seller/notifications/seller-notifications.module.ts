import { Module } from '@nestjs/common';
import { NotificationModule } from '../../notification/notification.module';
import { SellerNotificationsController } from './seller-notifications.controller';

@Module({
  imports: [NotificationModule],
  controllers: [SellerNotificationsController],
})
export class SellerNotificationsModule {}
