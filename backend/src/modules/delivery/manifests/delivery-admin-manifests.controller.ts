import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliveryAdminPermission } from '../auth/decorators/require-delivery-admin-permission.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from '../auth/guards/delivery-admin-permission.guard';
import { UpsertDeliveryManifestCustomizationDto } from './dto/manifest-target-customization.dto';
import { RegenerateDeliveryManifestDto } from './dto/regenerate-delivery-manifest.dto';
import { DeliveryManifestsService } from './delivery-manifests.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard, DeliveryAdminPermissionGuard)
@Controller('delivery-admin/manifests')
export class DeliveryAdminManifestsController {
  constructor(private readonly deliveryManifestsService: DeliveryManifestsService) {}

  @Get()
  @RequireDeliveryAdminPermission('delivery:manifests:read')
  listTemplates() {
    return this.deliveryManifestsService.listAdminTemplates();
  }

  @Get('customization')
  @RequireDeliveryAdminPermission('delivery:manifests:read')
  getCustomization(
    @Query('manifestType') manifestType: string,
    @Query('targetId') targetId: string,
  ) {
    return this.deliveryManifestsService.getTargetCustomization(manifestType as any, targetId);
  }

  @Post(':id/regenerate')
  @RequireDeliveryAdminPermission('delivery:manifests:write')
  regenerate(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
    @Body() dto: RegenerateDeliveryManifestDto,
  ) {
    return this.deliveryManifestsService.regenerateTemplate(deliveryAdminUserId, id, dto);
  }

  @Post('customization')
  @RequireDeliveryAdminPermission('delivery:manifests:write')
  upsertCustomization(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Body() dto: UpsertDeliveryManifestCustomizationDto,
  ) {
    return this.deliveryManifestsService.upsertTargetCustomization(deliveryAdminUserId, dto);
  }
}
