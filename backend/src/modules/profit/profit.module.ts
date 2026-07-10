import { Module } from '@nestjs/common';
import { OrderProfitSnapshotService } from './order-profit-snapshot.service';
import { OrderProfitRefundService } from './order-profit-refund.service';

@Module({
  providers: [OrderProfitSnapshotService, OrderProfitRefundService],
  exports: [OrderProfitSnapshotService, OrderProfitRefundService],
})
export class ProfitModule {}
