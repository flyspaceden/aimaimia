import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CaptainBuyerService } from './captain-buyer.service';
import { BindCaptainCodeDto } from './dto/captain-buyer.dto';

@Controller('captain')
export class CaptainController {
  constructor(private readonly buyerService: CaptainBuyerService) {}

  @Public()
  @Get('landing/:code')
  getLanding(@Param('code') code: string) {
    return this.buyerService.getLanding(code);
  }

  @Post('bind')
  bindByCode(
    @CurrentUser('sub') userId: string,
    @Body() dto: BindCaptainCodeDto,
  ) {
    return this.buyerService.bindByCode(userId, dto.code);
  }

  @Get('me')
  getMyCaptainProfile(@CurrentUser('sub') userId: string) {
    return this.buyerService.getMyCaptainProfile(userId);
  }

  @Get('me/ledgers')
  listMyLedgers(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.buyerService.listMyLedgers(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @Get('me/orders')
  listMyOrders(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.buyerService.listMyOrders(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }
}
