import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { DeliveryShippingService } from './delivery-shipping.service';

@Public()
@UseGuards(DeliverySellerAuthGuard)
@Controller('delivery-seller/orders')
export class DeliverySellerShippingController {
  constructor(private readonly deliveryShippingService: DeliveryShippingService) {}

  @Post(':subOrderId/ship')
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
  listShipments(
    @CurrentUser('merchantId') merchantId: string,
    @Param('subOrderId') subOrderId: string,
  ) {
    return this.deliveryShippingService.listSellerShipments(merchantId, subOrderId);
  }
}
