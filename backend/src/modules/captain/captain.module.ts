import { Module } from '@nestjs/common';
import { CaptainConfigService } from './captain-config.service';
import { CaptainRelationService } from './captain-relation.service';

@Module({
  providers: [CaptainConfigService, CaptainRelationService],
  exports: [CaptainConfigService, CaptainRelationService],
})
export class CaptainModule {}
