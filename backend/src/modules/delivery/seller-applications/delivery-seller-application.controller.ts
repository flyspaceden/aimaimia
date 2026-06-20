import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { CreateDeliverySellerApplicationDto } from './dto/create-delivery-seller-application.dto';
import { DeliverySellerApplicationService } from './delivery-seller-application.service';

@Public()
@Controller('delivery-seller/merchant-applications')
export class DeliverySellerApplicationController {
  constructor(private readonly deliverySellerApplicationService: DeliverySellerApplicationService) {}

  @Post()
  create(@Body() dto: CreateDeliverySellerApplicationDto) {
    return this.deliverySellerApplicationService.create(dto);
  }
}
