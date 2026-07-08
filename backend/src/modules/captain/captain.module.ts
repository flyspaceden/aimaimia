import { Module } from '@nestjs/common';
import { CaptainAttributionService } from './captain-attribution.service';
import { CaptainBuyerService } from './captain-buyer.service';
import { CaptainController } from './captain.controller';
import { CaptainCommissionService } from './captain-commission.service';
import { CaptainConfigService } from './captain-config.service';
import { CaptainMonthlySettlementService } from './captain-monthly-settlement.service';
import { CaptainRelationService } from './captain-relation.service';

@Module({
  controllers: [CaptainController],
  providers: [
    CaptainAttributionService,
    CaptainBuyerService,
    CaptainCommissionService,
    CaptainMonthlySettlementService,
    CaptainConfigService,
    CaptainRelationService,
  ],
  exports: [
    CaptainAttributionService,
    CaptainBuyerService,
    CaptainCommissionService,
    CaptainMonthlySettlementService,
    CaptainConfigService,
    CaptainRelationService,
  ],
})
export class CaptainModule {}
