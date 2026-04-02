import { Module } from '@nestjs/common';
import { CouponController } from './coupon.controller';
import { CouponService } from './coupon.service';
import { CouponEngineService } from './coupon-engine.service';

@Module({
  controllers: [CouponController],
  providers: [CouponService, CouponEngineService],
  exports: [CouponService, CouponEngineService],
})
export class CouponModule {}
