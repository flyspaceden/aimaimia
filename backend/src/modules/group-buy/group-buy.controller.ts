import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { WithdrawDto } from '../bonus/dto/withdraw.dto';
import { WithdrawPayoutService } from '../bonus/withdraw-payout.service';
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
    private readonly withdrawPayoutService: WithdrawPayoutService,
  ) {}

  @Get('activities')
  @Public()
  findActiveActivities() {
    return this.groupBuyService.findActiveActivities();
  }

  @Get('landing/:code')
  @Public()
  getLanding(@Param('code') code: string) {
    return this.groupBuyService.getLandingByCode(code);
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

  @Post('me/rebate-withdraw')
  requestRebateWithdraw(
    @CurrentUser('sub') userId: string,
    @Body() dto: WithdrawDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new BadRequestException('Idempotency-Key header required');
    }
    return this.withdrawPayoutService.requestGroupBuyRebateWithdraw(
      userId,
      dto,
      idempotencyKey.trim(),
    );
  }

  @Get('me/rebate-withdraw/history')
  listRebateWithdrawals(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.rebateService.listWithdrawals(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }
}
