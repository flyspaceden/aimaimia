import { Module } from '@nestjs/common';
import { NotificationModule } from '../../notification/notification.module';
import { AdminNotificationsController } from './admin-notifications.controller';

@Module({
  imports: [NotificationModule],
  controllers: [AdminNotificationsController],
})
export class AdminNotificationsModule {}
