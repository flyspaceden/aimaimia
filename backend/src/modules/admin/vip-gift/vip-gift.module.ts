import { Module } from '@nestjs/common';
import { VipGiftController } from './vip-gift.controller';
import { VipGiftService } from './vip-gift.service';
import { BonusModule } from '../../bonus/bonus.module';

@Module({
  imports: [BonusModule],
  controllers: [VipGiftController],
  providers: [VipGiftService],
  exports: [VipGiftService],
})
export class VipGiftModule {}
