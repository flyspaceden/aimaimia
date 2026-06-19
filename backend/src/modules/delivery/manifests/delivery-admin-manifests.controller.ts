import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { RegenerateDeliveryManifestDto } from './dto/regenerate-delivery-manifest.dto';
import { DeliveryManifestsService } from './delivery-manifests.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard)
@Controller('delivery-admin/manifests')
export class DeliveryAdminManifestsController {
  constructor(private readonly deliveryManifestsService: DeliveryManifestsService) {}

  @Get()
  listTemplates() {
    return this.deliveryManifestsService.listAdminTemplates();
  }

  @Post(':id/regenerate')
  regenerate(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
    @Body() dto: RegenerateDeliveryManifestDto,
  ) {
    return this.deliveryManifestsService.regenerateTemplate(deliveryAdminUserId, id, dto);
  }
}
