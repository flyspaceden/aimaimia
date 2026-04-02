import { Module } from '@nestjs/common';
import { AdminRefundsController } from './admin-refunds.controller';
import { AdminRefundsService } from './admin-refunds.service';
import { BonusModule } from '../../bonus/bonus.module';
import { PaymentModule } from '../../payment/payment.module';

@Module({
  imports: [BonusModule, PaymentModule],
  controllers: [AdminRefundsController],
  providers: [AdminRefundsService],
})
export class AdminRefundsModule {}
