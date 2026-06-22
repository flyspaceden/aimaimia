import { Body, Controller, Get, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GroupBuyCheckoutDto } from './dto/group-buy-checkout.dto';
import { GroupBuyCheckoutService } from './group-buy-checkout.service';
import { GroupBuyService } from './group-buy.service';

@Controller('group-buy')
export class GroupBuyController {
  constructor(
    private readonly groupBuyService: GroupBuyService,
    private readonly checkoutService: GroupBuyCheckoutService,
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
}
