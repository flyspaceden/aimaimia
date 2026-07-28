import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { QueueRewardController } from './queue-reward.controller';
import { QueueRewardService } from './queue-reward.service';

@Module({
  imports: [NotificationModule],
  controllers: [QueueRewardController],
  providers: [QueueRewardService],
  exports: [QueueRewardService],
})
export class QueueRewardModule {}
