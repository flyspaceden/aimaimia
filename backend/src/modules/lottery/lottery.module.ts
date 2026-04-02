import { Module } from '@nestjs/common';
import { LotteryController } from './lottery.controller';
import { LotteryService } from './lottery.service';
import { BonusModule } from '../bonus/bonus.module';

@Module({
  imports: [BonusModule],
  controllers: [LotteryController],
  providers: [LotteryService],
})
export class LotteryModule {}
