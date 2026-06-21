import { Body, Controller, Get, Patch, Post, Query, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliveryAdminPermission } from '../auth/decorators/require-delivery-admin-permission.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from '../auth/guards/delivery-admin-permission.guard';
import { CreateDeliveryPriceRuleDto } from './dto/create-delivery-price-rule.dto';
import { ListDeliveryPriceRulesQueryDto } from './dto/list-delivery-price-rules.query.dto';
import { UpdateDeliveryPriceRuleDto } from './dto/update-delivery-price-rule.dto';
import { DeliveryPricingService } from './delivery-pricing.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard, DeliveryAdminPermissionGuard)
@Controller('delivery-admin/pricing-rules')
export class DeliveryAdminPricingRulesController {
  constructor(private readonly deliveryPricingService: DeliveryPricingService) {}

  @Get()
  @RequireDeliveryAdminPermission('delivery:config:read')
  list(@Query() query: ListDeliveryPriceRulesQueryDto) {
    return this.deliveryPricingService.listRules(query);
  }

  @Post()
  @RequireDeliveryAdminPermission('delivery:config:write')
  create(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: CreateDeliveryPriceRuleDto,
  ) {
    return this.deliveryPricingService.createRule(dto, deliveryAdminUserId);
  }

  @Patch(':id')
  @RequireDeliveryAdminPermission('delivery:config:write')
  update(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryPriceRuleDto,
  ) {
    return this.deliveryPricingService.updateRule(id, dto, deliveryAdminUserId);
  }
}
