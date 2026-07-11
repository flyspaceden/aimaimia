import { Module } from '@nestjs/common';
import { ProfitModule } from '../../profit/profit.module';

import { GroupBuyModule } from '../../group-buy/group-buy.module';
import { AdminGroupBuyController } from './admin-group-buy.controller';
import { AdminGroupBuyService } from './admin-group-buy.service';

@Module({
  imports: [GroupBuyModule, ProfitModule],
  controllers: [AdminGroupBuyController],
  providers: [AdminGroupBuyService],
})
export class AdminGroupBuyModule {}
