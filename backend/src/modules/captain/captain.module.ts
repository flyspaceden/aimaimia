import { Module } from '@nestjs/common';
import { CaptainAttributionService } from './captain-attribution.service';
import { CaptainCommissionService } from './captain-commission.service';
import { CaptainConfigService } from './captain-config.service';
import { CaptainMonthlySettlementService } from './captain-monthly-settlement.service';
import { CaptainRelationService } from './captain-relation.service';

@Module({
  providers: [
    CaptainAttributionService,
    CaptainCommissionService,
    CaptainMonthlySettlementService,
    CaptainConfigService,
    CaptainRelationService,
  ],
  exports: [
    CaptainAttributionService,
    CaptainCommissionService,
    CaptainMonthlySettlementService,
    CaptainConfigService,
    CaptainRelationService,
  ],
})
export class CaptainModule {}
