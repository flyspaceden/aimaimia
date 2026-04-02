import { Module } from '@nestjs/common';
import { AdminLotteryController } from './admin-lottery.controller';
import { AdminLotteryService } from './admin-lottery.service';
import { BonusModule } from '../../bonus/bonus.module';

@Module({
  imports: [BonusModule],
  controllers: [AdminLotteryController],
  providers: [AdminLotteryService],
})
export class AdminLotteryModule {}
