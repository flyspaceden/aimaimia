import { Module } from '@nestjs/common';

import { GroupBuyCheckoutService } from './group-buy-checkout.service';
import { GroupBuyController } from './group-buy.controller';
import { GroupBuyLifecycleService } from './group-buy-lifecycle.service';
import { GroupBuyRebateService } from './group-buy-rebate.service';
import { GroupBuyService } from './group-buy.service';

@Module({
  controllers: [GroupBuyController],
  providers: [
    GroupBuyService,
    GroupBuyCheckoutService,
    GroupBuyLifecycleService,
    GroupBuyRebateService,
  ],
  exports: [GroupBuyCheckoutService, GroupBuyLifecycleService, GroupBuyRebateService],
})
export class GroupBuyModule {}
