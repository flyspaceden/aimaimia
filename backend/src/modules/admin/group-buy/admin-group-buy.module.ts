import { Module } from '@nestjs/common';

import { AdminGroupBuyController } from './admin-group-buy.controller';
import { AdminGroupBuyService } from './admin-group-buy.service';

@Module({
  controllers: [AdminGroupBuyController],
  providers: [AdminGroupBuyService],
})
export class AdminGroupBuyModule {}
