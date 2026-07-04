import { Module } from '@nestjs/common';
import { GrowthController } from './growth.controller';
import { GrowthLevelService } from './growth-level.service';
import { GrowthService } from './growth.service';

@Module({
  controllers: [GrowthController],
  providers: [GrowthService, GrowthLevelService],
  exports: [GrowthService, GrowthLevelService],
})
export class GrowthModule {}
