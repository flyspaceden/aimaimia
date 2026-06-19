import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { UpdateDeliveryConfigDto } from './dto/update-delivery-config.dto';
import { DeliveryConfigService } from './delivery-config.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard)
@Controller('delivery-admin/config')
export class DeliveryAdminConfigController {
  constructor(private readonly deliveryConfigService: DeliveryConfigService) {}

  @Get()
  list(@Query('scope') scope?: string) {
    return this.deliveryConfigService.list(scope);
  }

  @Patch()
  update(@Body() dto: UpdateDeliveryConfigDto) {
    return this.deliveryConfigService.update(dto.items);
  }
}
