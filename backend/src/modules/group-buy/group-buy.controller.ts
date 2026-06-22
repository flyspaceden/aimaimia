import { Body, Controller, Get, Post, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GroupBuyCheckoutDto } from './dto/group-buy-checkout.dto';
import { GroupBuyCheckoutService } from './group-buy-checkout.service';
import { GroupBuyLifecycleService } from './group-buy-lifecycle.service';
import { GroupBuyRebateService } from './group-buy-rebate.service';
import { GroupBuyService } from './group-buy.service';

@Controller('group-buy')
export class GroupBuyController {
  constructor(
    private readonly groupBuyService: GroupBuyService,
    private readonly checkoutService: GroupBuyCheckoutService,
    private readonly lifecycleService: GroupBuyLifecycleService,
    private readonly rebateService: GroupBuyRebateService,
  ) {}

  @Get('activities')
  findActiveActivities() {
    return this.groupBuyService.findActiveActivities();
  }

  @Get('me/current')
  getCurrentState(@CurrentUser('sub') userId: string) {
    return this.groupBuyService.getCurrentState(userId);
  }

  @Post('checkout')
  createCheckout(
    @CurrentUser('sub') userId: string,
    @Body() dto: GroupBuyCheckoutDto,
  ) {
    return this.checkoutService.createCheckout(userId, dto);
  }

  @Post('me/current/abandon')
  abandonCurrent(@CurrentUser('sub') userId: string) {
    return this.lifecycleService.abandonCurrent(userId);
  }

  @Post('me/current/terminate')
  terminateCurrent(@CurrentUser('sub') userId: string) {
    return this.lifecycleService.terminateCurrent(userId);
  }

  @Get('me/rebate-account')
  getRebateAccount(@CurrentUser('sub') userId: string) {
    return this.rebateService.getAccount(userId);
  }

  @Get('me/rebate-ledgers')
  listRebateLedgers(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.rebateService.listLedgers(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }
}
