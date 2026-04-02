import { Module } from '@nestjs/common';
import { AdminCouponController } from './admin-coupon.controller';
import { CouponModule } from '../../coupon/coupon.module';

@Module({
  imports: [CouponModule],
  controllers: [AdminCouponController],
})
export class AdminCouponModule {}
