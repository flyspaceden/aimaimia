import { Module } from '@nestjs/common';
import { CaptainAttributionService } from './captain-attribution.service';
import { CaptainConfigService } from './captain-config.service';
import { CaptainRelationService } from './captain-relation.service';

@Module({
  providers: [CaptainAttributionService, CaptainConfigService, CaptainRelationService],
  exports: [CaptainAttributionService, CaptainConfigService, CaptainRelationService],
})
export class CaptainModule {}
