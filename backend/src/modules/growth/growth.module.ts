import { Module } from '@nestjs/common';
import { BonusModule } from '../bonus/bonus.module';
import { CouponModule } from '../coupon/coupon.module';
import { GrowthController } from './growth.controller';
import { GrowthCouponAdapterService } from './growth-coupon-adapter.service';
import { GrowthEventService } from './growth-event.service';
import { GrowthExchangeService } from './growth-exchange.service';
import { GrowthExpireService } from './growth-expire.service';
import { GrowthLevelService } from './growth-level.service';
import { GrowthService } from './growth.service';

@Module({
  imports: [CouponModule, BonusModule],
  controllers: [GrowthController],
  providers: [
    GrowthService,
    GrowthLevelService,
    GrowthEventService,
    GrowthExpireService,
    GrowthCouponAdapterService,
    GrowthExchangeService,
  ],
  exports: [
    GrowthService,
    GrowthLevelService,
    GrowthEventService,
    GrowthExpireService,
    GrowthCouponAdapterService,
    GrowthExchangeService,
  ],
})
export class GrowthModule {}
