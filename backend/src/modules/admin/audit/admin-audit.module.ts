import { Module } from '@nestjs/common';
import { ProfitModule } from '../../profit/profit.module';
import { BonusModule } from '../../bonus/bonus.module';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';

@Module({
  imports: [ProfitModule, BonusModule],
  controllers: [AdminAuditController],
  providers: [AdminAuditService],
})
export class AdminAuditModule {}
