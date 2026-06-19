import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { DeliveryManifestsService } from './delivery-manifests.service';

@Public()
@UseGuards(DeliverySellerAuthGuard)
@Controller('delivery-seller')
export class DeliverySellerManifestsController {
  constructor(private readonly deliveryManifestsService: DeliveryManifestsService) {}

  @Get('orders/:subOrderId/fulfillment-manifest')
  getFulfillmentManifest(
    @CurrentUser('merchantId') merchantId: string,
    @Param('subOrderId') subOrderId: string,
  ) {
    return this.deliveryManifestsService.getSellerFulfillmentManifest(merchantId, subOrderId);
  }

  @Get('finance/export')
  exportFinance(@CurrentUser('merchantId') merchantId: string) {
    return this.deliveryManifestsService.exportSellerFinanceManifest(merchantId);
  }
}
