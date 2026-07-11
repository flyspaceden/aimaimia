import { Module } from '@nestjs/common';
import { ProfitModule } from '../../profit/profit.module';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';

@Module({
  imports: [ProfitModule],
  controllers: [AdminAuditController],
  providers: [AdminAuditService],
})
export class AdminAuditModule {}
