import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliveryAdminPermission } from '../auth/decorators/require-delivery-admin-permission.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from '../auth/guards/delivery-admin-permission.guard';
import { UpdateUnitFieldConfigDto } from './dto/update-unit-field-config.dto';
import { DeliveryUnitFieldConfigService } from './unit-field-config.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard, DeliveryAdminPermissionGuard)
@Controller('delivery-admin/unit-field-config')
export class UnitFieldConfigController {
  constructor(private readonly deliveryUnitFieldConfigService: DeliveryUnitFieldConfigService) {}

  @Get()
  @RequireDeliveryAdminPermission('delivery:config:read')
  getConfigs() {
    return this.deliveryUnitFieldConfigService.getConfigs();
  }

  @Patch()
  @RequireDeliveryAdminPermission('delivery:config:write')
  update(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: UpdateUnitFieldConfigDto,
  ) {
    return this.deliveryUnitFieldConfigService.updateConfigs(dto.items, deliveryAdminUserId);
  }
}
