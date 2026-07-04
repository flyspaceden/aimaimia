import { Module } from '@nestjs/common';
import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';
import { CouponModule } from '../coupon/coupon.module';
import { GrowthModule } from '../growth/growth.module';

@Module({
  imports: [CouponModule, GrowthModule],
  controllers: [CheckInController],
  providers: [CheckInService],
})
export class CheckInModule {}
