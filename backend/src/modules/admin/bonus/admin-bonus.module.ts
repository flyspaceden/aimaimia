import { Module } from '@nestjs/common';
import { AdminBonusController } from './admin-bonus.controller';
import { AdminBonusService } from './admin-bonus.service';
import { InboxModule } from '../../inbox/inbox.module';

@Module({
  imports: [InboxModule],
  controllers: [AdminBonusController],
  providers: [AdminBonusService],
})
export class AdminBonusModule {}
