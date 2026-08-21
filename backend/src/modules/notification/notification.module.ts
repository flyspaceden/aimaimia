import { Module } from '@nestjs/common';
import { MiniProgramSubscriptionController } from '../mini-program/mini-program-subscription.controller';
import { MiniProgramSubscriptionService } from '../mini-program/mini-program-subscription.service';
import { MiniProgramCodeController } from '../mini-program/mini-program-code.controller';
import { MiniProgramCodeService } from '../mini-program/mini-program-code.service';
import { WechatMiniProgramPlatformModule } from '../wechat-mini-program-platform/wechat-mini-program-platform.module';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationMessageService } from './notification-message.service';
import { NotificationRegistry } from './notification.registry';
import { NotificationService } from './notification.service';

@Module({
  imports: [WechatMiniProgramPlatformModule],
  controllers: [MiniProgramSubscriptionController, MiniProgramCodeController],
  providers: [
    NotificationRegistry,
    NotificationService,
    NotificationDispatcherService,
    NotificationMessageService,
    MiniProgramSubscriptionService,
    MiniProgramCodeService,
  ],
  exports: [NotificationService, NotificationMessageService, MiniProgramSubscriptionService],
})
export class NotificationModule {}
