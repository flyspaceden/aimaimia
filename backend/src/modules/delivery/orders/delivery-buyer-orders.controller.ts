import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryUserAuthGuard } from '../auth/guards/delivery-user-auth.guard';
import { DeliveryOrdersService } from './delivery-orders.service';

@Public()
@UseGuards(DeliveryUserAuthGuard)
@Controller('delivery')
export class DeliveryBuyerOrdersController {
  constructor(private readonly deliveryOrdersService: DeliveryOrdersService) {}

  @Get('orders')
  listOrders(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.deliveryOrdersService.listBuyerOrders(deliveryUserId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      status,
    });
  }

  @Get('orders/:id')
  getOrder(
    @CurrentUser('deliveryUserId') deliveryUserId: string,
    @Param('id') orderId: string,
  ) {
    return this.deliveryOrdersService.getBuyerOrder(deliveryUserId, orderId);
  }
}
