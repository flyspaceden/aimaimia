import { Module } from '@nestjs/common';
import { GrowthController } from './growth.controller';
import { GrowthEventService } from './growth-event.service';
import { GrowthExpireService } from './growth-expire.service';
import { GrowthLevelService } from './growth-level.service';
import { GrowthService } from './growth.service';

@Module({
  controllers: [GrowthController],
  providers: [GrowthService, GrowthLevelService, GrowthEventService, GrowthExpireService],
  exports: [GrowthService, GrowthLevelService, GrowthEventService, GrowthExpireService],
})
export class GrowthModule {}
