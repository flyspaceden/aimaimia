import { Module } from '@nestjs/common';
import { VipGiftController } from './vip-gift.controller';
import { VipGiftService } from './vip-gift.service';

@Module({
  controllers: [VipGiftController],
  providers: [VipGiftService],
  exports: [VipGiftService],
})
export class VipGiftModule {}
