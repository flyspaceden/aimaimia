import { Module } from '@nestjs/common';
import { ProfitModule } from '../../profit/profit.module';
import { AdminGrowthController } from './admin-growth.controller';
import { AdminGrowthService } from './admin-growth.service';

@Module({
  imports: [ProfitModule],
  controllers: [AdminGrowthController],
  providers: [AdminGrowthService],
})
export class AdminGrowthModule {}
