import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryShippingService } from './delivery-shipping.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard)
@Controller('delivery-admin/shipping-records')
export class DeliveryAdminShippingRecordsController {
  constructor(private readonly deliveryShippingService: DeliveryShippingService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.deliveryShippingService.listAdminShippingRecords({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }
}
