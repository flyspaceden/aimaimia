import { Module } from '@nestjs/common';
import { AdminReconciliationController } from './admin-reconciliation.controller';
import { AdminReconciliationService } from './admin-reconciliation.service';

@Module({
  controllers: [AdminReconciliationController],
  providers: [AdminReconciliationService],
})
export class AdminReconciliationModule {}

