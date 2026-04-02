import { Module } from '@nestjs/common';
import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';
import { CouponModule } from '../coupon/coupon.module';

@Module({
  imports: [CouponModule],
  controllers: [CheckInController],
  providers: [CheckInService],
})
export class CheckInModule {}
