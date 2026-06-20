import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { DeliveryUserAuthGuard } from '../auth/guards/delivery-user-auth.guard';
import { CreateDeliveryUnitDto } from './dto/create-delivery-unit.dto';
import { UpdateDeliveryUnitDto } from './dto/update-delivery-unit.dto';
import { DeliveryUnitsService } from './delivery-units.service';
import { DeliveryUnitFieldConfigService } from '../admin/unit-field-config.service';

@Public()
@UseGuards(DeliveryUserAuthGuard)
@Controller('delivery')
export class DeliveryUnitsController {
  constructor(
    private readonly deliveryUnitsService: DeliveryUnitsService,
    private readonly deliveryUnitFieldConfigService: DeliveryUnitFieldConfigService,
  ) {}

  @Get('unit-field-config')
  async getUnitFieldConfig() {
    const configs = await this.deliveryUnitFieldConfigService.getConfigs();
    return configs.filter((config) => config.isVisible && config.showInApp);
  }

  @Get('units')
  listUnits(@CurrentUser('deliveryUserId') deliveryUserId: string) {
    return this.deliveryUnitsService.listUnits(deliveryUserId);
  }

  @Post('units')
  createUnit(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Body() dto: CreateDeliveryUnitDto,
  ) {
    return this.deliveryUnitsService.createUnit(deliveryUserId, dto);
  }

  @Patch('units/:id')
  updateUnit(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Param('id') unitId: string,
    @Body() dto: UpdateDeliveryUnitDto,
  ) {
    return this.deliveryUnitsService.updateUnit(deliveryUserId, unitId, dto);
  }

  @Post('units/:id/select')
  selectUnit(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Param('id') unitId: string,
  ) {
    return this.deliveryUnitsService.selectUnit(deliveryUserId, unitId);
  }
}
