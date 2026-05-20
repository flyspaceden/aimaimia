import { Module } from '@nestjs/common';
import { AdminBonusController } from './admin-bonus.controller';
import { AdminBonusService } from './admin-bonus.service';
import { InboxModule } from '../../inbox/inbox.module';
import { BonusModule } from '../../bonus/bonus.module';
import { PaymentModule } from '../../payment/payment.module';

@Module({
  imports: [InboxModule, BonusModule, PaymentModule],
  controllers: [AdminBonusController],
  providers: [AdminBonusService],
})
export class AdminBonusModule {}
