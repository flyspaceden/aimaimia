import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliverySellerPublicService } from './delivery-seller-public.service';

@Public()
@Controller('delivery-seller')
export class DeliverySellerPublicController {
  constructor(private readonly deliverySellerPublicService: DeliverySellerPublicService) {}

  @Get('config/public')
  getPublicConfig() {
    return this.deliverySellerPublicService.getPublicConfig();
  }

  @Get('product-units')
  listProductUnits() {
    return this.deliverySellerPublicService.listProductUnits();
  }

  @Get('categories')
  listCategories() {
    return this.deliverySellerPublicService.listCategories();
  }

  @Get('tag-categories')
  listTagCategories(@Query('scope') scope?: string) {
    return this.deliverySellerPublicService.listTagCategories(scope);
  }
}
