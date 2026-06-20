import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliverySellerPermission } from '../auth/decorators/require-delivery-seller-permission.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { DeliverySellerPermissionGuard } from '../auth/guards/delivery-seller-permission.guard';
import { DeliveryShippingService } from './delivery-shipping.service';

@Public()
@UseGuards(DeliverySellerAuthGuard, DeliverySellerPermissionGuard)
@Controller('delivery-seller/orders')
export class DeliverySellerShippingController {
  constructor(private readonly deliveryShippingService: DeliveryShippingService) {}

  @Post(':subOrderId/ship')
  @RequireDeliverySellerPermission('orders:write')
  ship(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @Param('subOrderId') subOrderId: string,
  ) {
    return this.deliveryShippingService.shipSubOrder(
      merchantId,
      deliverySellerStaffId,
      subOrderId,
    );
  }

  @Get(':subOrderId/shipments')
  @RequireDeliverySellerPermission('orders:read')
  listShipments(
    @CurrentUser('merchantId') merchantId: string,
    @Param('subOrderId') subOrderId: string,
  ) {
    return this.deliveryShippingService.listSellerShipments(merchantId, subOrderId);
  }
}
