import { Module } from '@nestjs/common';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationMessageService } from './notification-message.service';
import { NotificationRegistry } from './notification.registry';
import { NotificationService } from './notification.service';

@Module({
  providers: [
    NotificationRegistry,
    NotificationService,
    NotificationDispatcherService,
    NotificationMessageService,
  ],
  exports: [NotificationService, NotificationMessageService],
})
export class NotificationModule {}
