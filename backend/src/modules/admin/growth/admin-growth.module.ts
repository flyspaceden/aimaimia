import { Module } from '@nestjs/common';
import { AdminGrowthController } from './admin-growth.controller';
import { AdminGrowthService } from './admin-growth.service';

@Module({
  controllers: [AdminGrowthController],
  providers: [AdminGrowthService],
})
export class AdminGrowthModule {}
