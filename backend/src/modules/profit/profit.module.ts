import { Module } from '@nestjs/common';
import { OrderProfitSnapshotService } from './order-profit-snapshot.service';
import { OrderProfitRefundService } from './order-profit-refund.service';
import { ProfitSafetyService } from './profit-safety.service';
import { ProfitSafetyValidator } from './profit-safety-validator';

@Module({
  providers: [
    OrderProfitSnapshotService,
    OrderProfitRefundService,
    ProfitSafetyValidator,
    ProfitSafetyService,
  ],
  exports: [
    OrderProfitSnapshotService,
    OrderProfitRefundService,
    ProfitSafetyValidator,
    ProfitSafetyService,
  ],
})
export class ProfitModule {}
