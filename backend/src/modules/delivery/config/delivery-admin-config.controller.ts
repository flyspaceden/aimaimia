import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliveryAdminPermission } from '../auth/decorators/require-delivery-admin-permission.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from '../auth/guards/delivery-admin-permission.guard';
import { UpdateDeliveryConfigDto } from './dto/update-delivery-config.dto';
import { DeliveryConfigService } from './delivery-config.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard, DeliveryAdminPermissionGuard)
@Controller('delivery-admin/config')
export class DeliveryAdminConfigController {
  constructor(private readonly deliveryConfigService: DeliveryConfigService) {}

  @Get()
  @RequireDeliveryAdminPermission('delivery:config:read')
  list(@Query('scope') scope?: string) {
    return this.deliveryConfigService.list(scope);
  }

  @Patch()
  @RequireDeliveryAdminPermission('delivery:config:write')
  update(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: UpdateDeliveryConfigDto,
  ) {
    return this.deliveryConfigService.update(dto.items, deliveryAdminUserId);
  }
}
