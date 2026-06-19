import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryUserAuthGuard } from '../auth/guards/delivery-user-auth.guard';
import { DeliveryShippingService } from './delivery-shipping.service';

@Public()
@UseGuards(DeliveryUserAuthGuard)
@Controller('delivery/orders')
export class DeliveryOrderShipmentsController {
  constructor(private readonly deliveryShippingService: DeliveryShippingService) {}

  @Get(':orderId/shipments')
  listShipments(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.deliveryShippingService.listBuyerShipments(deliveryUserId, orderId);
  }
}
