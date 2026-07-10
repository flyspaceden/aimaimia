import { Module } from '@nestjs/common';
import { OrderProfitSnapshotService } from './order-profit-snapshot.service';

@Module({
  providers: [OrderProfitSnapshotService],
  exports: [OrderProfitSnapshotService],
})
export class ProfitModule {}
