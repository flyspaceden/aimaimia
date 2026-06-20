import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryUserAuthGuard } from '../auth/guards/delivery-user-auth.guard';
import { DeliveryManifestsService } from './delivery-manifests.service';

@Public()
@UseGuards(DeliveryUserAuthGuard)
@Controller('delivery')
export class DeliveryManifestsController {
  constructor(private readonly deliveryManifestsService: DeliveryManifestsService) {}

  @Get('manifests')
  listManifests(@CurrentUser('deliveryUserId') deliveryUserId: string) {
    return this.deliveryManifestsService.listBuyerManifests(deliveryUserId);
  }

  @Get('orders/:orderId/manifest')
  getOrderManifest(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.deliveryManifestsService.getOrderManifest({
      orderId,
      viewer: { kind: 'buyer', deliveryUserId },
    });
  }
}
