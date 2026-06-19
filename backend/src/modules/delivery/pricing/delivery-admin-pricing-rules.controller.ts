import { Body, Controller, Get, Patch, Post, Query, Param, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { CreateDeliveryPriceRuleDto } from './dto/create-delivery-price-rule.dto';
import { ListDeliveryPriceRulesQueryDto } from './dto/list-delivery-price-rules.query.dto';
import { UpdateDeliveryPriceRuleDto } from './dto/update-delivery-price-rule.dto';
import { DeliveryPricingService } from './delivery-pricing.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard)
@Controller('delivery-admin/pricing-rules')
export class DeliveryAdminPricingRulesController {
  constructor(private readonly deliveryPricingService: DeliveryPricingService) {}

  @Get()
  list(@Query() query: ListDeliveryPriceRulesQueryDto) {
    return this.deliveryPricingService.listRules(query);
  }

  @Post()
  create(@Body() dto: CreateDeliveryPriceRuleDto) {
    return this.deliveryPricingService.createRule(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeliveryPriceRuleDto) {
    return this.deliveryPricingService.updateRule(id, dto);
  }
}
