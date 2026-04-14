import { Module } from '@nestjs/common';
import { CouponController } from './coupon.controller';
import { CouponService } from './coupon.service';
import { CouponEngineService } from './coupon-engine.service';
import { InboxModule } from '../inbox/inbox.module';

@Module({
  imports: [InboxModule],
  controllers: [CouponController],
  providers: [CouponService, CouponEngineService],
  exports: [CouponService, CouponEngineService],
})
export class CouponModule {}
