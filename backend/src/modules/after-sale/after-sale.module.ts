import { Module } from '@nestjs/common';
import { AfterSaleController } from './after-sale.controller';
import { AfterSaleService } from './after-sale.service';
import { AfterSaleRewardService } from './after-sale-reward.service';

@Module({
  controllers: [AfterSaleController],
  providers: [AfterSaleService, AfterSaleRewardService],
  exports: [AfterSaleService, AfterSaleRewardService],
})
export class AfterSaleModule {}
