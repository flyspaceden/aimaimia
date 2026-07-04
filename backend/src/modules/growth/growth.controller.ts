import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExchangeGrowthItemDto } from './dto/exchange-growth-item.dto';
import { GrowthExchangeService } from './growth-exchange.service';
import { GrowthService } from './growth.service';

@Controller('growth')
export class GrowthController {
  constructor(
    private readonly growthService: GrowthService,
    private readonly exchangeService: GrowthExchangeService,
  ) {}

  @Get('me')
  getMe(@CurrentUser('sub') userId: string) {
    return this.growthService.getMe(userId);
  }

  @Get('guide')
  getGuide(@CurrentUser('sub') userId: string) {
    return this.growthService.getGuide(userId);
  }

  @Get('exchange/items')
  getExchangeItems(@CurrentUser('sub') userId: string) {
    return this.exchangeService.listItems(userId);
  }

  @Post('exchange/:itemId')
  exchange(
    @CurrentUser('sub') userId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ExchangeGrowthItemDto,
  ) {
    return this.exchangeService.exchange(userId, itemId, dto);
  }

  @Get('exchange/records')
  getExchangeRecords(@CurrentUser('sub') userId: string) {
    return this.exchangeService.listRecords(userId);
  }
}
