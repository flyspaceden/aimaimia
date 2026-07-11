import { Module } from '@nestjs/common';
import { AdminLotteryController } from './admin-lottery.controller';
import { AdminLotteryService } from './admin-lottery.service';
import { BonusModule } from '../../bonus/bonus.module';
import { ProfitModule } from '../../profit/profit.module';

@Module({
  imports: [BonusModule, ProfitModule],
  controllers: [AdminLotteryController],
  providers: [AdminLotteryService],
})
export class AdminLotteryModule {}
