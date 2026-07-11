import { Module } from '@nestjs/common';
import { BonusModule } from '../../bonus/bonus.module';
import { CaptainModule } from '../../captain/captain.module';
import { ProfitModule } from '../../profit/profit.module';
import {
  AdminProfitAdjustmentController,
  AdminProfitReconciliationController,
} from './admin-profit-reconciliation.controller';
import { AdminProfitReconciliationService } from './admin-profit-reconciliation.service';

@Module({
  imports: [BonusModule, CaptainModule, ProfitModule],
  controllers: [
    AdminProfitReconciliationController,
    AdminProfitAdjustmentController,
  ],
  providers: [AdminProfitReconciliationService],
  exports: [AdminProfitReconciliationService],
})
export class AdminProfitReconciliationModule {}
