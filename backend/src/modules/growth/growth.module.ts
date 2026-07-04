import { Module } from '@nestjs/common';
import { CouponModule } from '../coupon/coupon.module';
import { GrowthController } from './growth.controller';
import { GrowthCouponAdapterService } from './growth-coupon-adapter.service';
import { GrowthEventService } from './growth-event.service';
import { GrowthExpireService } from './growth-expire.service';
import { GrowthLevelService } from './growth-level.service';
import { GrowthService } from './growth.service';

@Module({
  imports: [CouponModule],
  controllers: [GrowthController],
  providers: [
    GrowthService,
    GrowthLevelService,
    GrowthEventService,
    GrowthExpireService,
    GrowthCouponAdapterService,
  ],
  exports: [
    GrowthService,
    GrowthLevelService,
    GrowthEventService,
    GrowthExpireService,
    GrowthCouponAdapterService,
  ],
})
export class GrowthModule {}
