import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliverySellerPermission } from '../auth/decorators/require-delivery-seller-permission.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { DeliverySellerPermissionGuard } from '../auth/guards/delivery-seller-permission.guard';
import { DeliveryManifestsService } from './delivery-manifests.service';

@Public()
@UseGuards(DeliverySellerAuthGuard, DeliverySellerPermissionGuard)
@Controller('delivery-seller')
export class DeliverySellerManifestsController {
  constructor(private readonly deliveryManifestsService: DeliveryManifestsService) {}

  @Get('orders/:subOrderId/fulfillment-manifest')
  @RequireDeliverySellerPermission('orders:write')
  getFulfillmentManifest(
    @CurrentUser('merchantId') merchantId: string,
    @Param('subOrderId') subOrderId: string,
  ) {
    return this.deliveryManifestsService.getSellerFulfillmentManifest(merchantId, subOrderId);
  }

  @Get('finance/export')
  @RequireDeliverySellerPermission('finance:read')
  exportFinance(@CurrentUser('merchantId') merchantId: string) {
    return this.deliveryManifestsService.exportSellerFinanceManifest(merchantId);
  }
}
