import { Module } from '@nestjs/common';
import { CaptainApplicationService } from './captain-application.service';
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
    CaptainApplicationService,
    CaptainBuyerService,
    CaptainCommissionService,
    CaptainMonthlySettlementService,
    CaptainConfigService,
    CaptainRelationService,
  ],
  exports: [
    CaptainAttributionService,
    CaptainApplicationService,
    CaptainBuyerService,
    CaptainCommissionService,
    CaptainMonthlySettlementService,
    CaptainConfigService,
    CaptainRelationService,
  ],
})
export class CaptainModule {}
