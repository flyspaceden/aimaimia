import { Module } from '@nestjs/common';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
