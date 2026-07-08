import { Module } from '@nestjs/common';
import { CaptainAttributionService } from './captain-attribution.service';
import { CaptainCommissionService } from './captain-commission.service';
import { CaptainConfigService } from './captain-config.service';
import { CaptainRelationService } from './captain-relation.service';

@Module({
  providers: [
    CaptainAttributionService,
    CaptainCommissionService,
    CaptainConfigService,
    CaptainRelationService,
  ],
  exports: [
    CaptainAttributionService,
    CaptainCommissionService,
    CaptainConfigService,
    CaptainRelationService,
  ],
})
export class CaptainModule {}
