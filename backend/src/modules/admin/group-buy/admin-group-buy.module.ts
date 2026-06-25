import { Module } from '@nestjs/common';

import { GroupBuyModule } from '../../group-buy/group-buy.module';
import { AdminGroupBuyController } from './admin-group-buy.controller';
import { AdminGroupBuyService } from './admin-group-buy.service';

@Module({
  imports: [GroupBuyModule],
  controllers: [AdminGroupBuyController],
  providers: [AdminGroupBuyService],
})
export class AdminGroupBuyModule {}
