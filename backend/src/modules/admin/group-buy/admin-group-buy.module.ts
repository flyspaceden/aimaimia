import { Module } from '@nestjs/common';
import { ProfitModule } from '../../profit/profit.module';

import { AdminGroupBuyController } from './admin-group-buy.controller';
import { AdminGroupBuyService } from './admin-group-buy.service';

@Module({
  imports: [ProfitModule],
  controllers: [AdminGroupBuyController],
  providers: [AdminGroupBuyService],
})
export class AdminGroupBuyModule {}
