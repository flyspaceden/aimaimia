import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { UpdateUnitFieldConfigDto } from './dto/update-unit-field-config.dto';
import { DeliveryUnitFieldConfigService } from './unit-field-config.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard)
@Controller('delivery-admin/unit-field-config')
export class UnitFieldConfigController {
  constructor(private readonly deliveryUnitFieldConfigService: DeliveryUnitFieldConfigService) {}

  @Get()
  getConfigs() {
    return this.deliveryUnitFieldConfigService.getConfigs();
  }

  @Patch()
  update(@Body() dto: UpdateUnitFieldConfigDto) {
    return this.deliveryUnitFieldConfigService.updateConfigs(dto.items);
  }
}
