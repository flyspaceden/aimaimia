import { Body, Controller, Get, Patch, Post, Param, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { CreateDeliveryProductDto } from './dto/create-delivery-product.dto';
import { ListDeliveryProductsQueryDto } from './dto/list-delivery-products.query.dto';
import { UpdateDeliveryProductDto } from './dto/update-delivery-product.dto';
import { DeliveryProductsService } from './delivery-products.service';

@Public()
@UseGuards(DeliverySellerAuthGuard)
@Controller('delivery-seller/products')
export class DeliverySellerProductsController {
  constructor(private readonly deliveryProductsService: DeliveryProductsService) {}

  @Get()
  list(
    @CurrentUser('merchantId') merchantId: string,
    @Query() query: ListDeliveryProductsQueryDto,
  ) {
    return this.deliveryProductsService.listSellerProducts(merchantId, query);
  }

  @Get(':id')
  getOne(@CurrentUser('merchantId') merchantId: string, @Param('id') id: string) {
    return this.deliveryProductsService.getSellerProduct(merchantId, id);
  }

  @Post()
  create(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @Body() dto: CreateDeliveryProductDto,
  ) {
    return this.deliveryProductsService.createSellerProduct(merchantId, deliverySellerStaffId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser('merchantId') merchantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryProductDto,
  ) {
    return this.deliveryProductsService.updateSellerProduct(merchantId, id, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser('merchantId') merchantId: string, @Param('id') id: string) {
    return this.deliveryProductsService.submitSellerProduct(merchantId, id);
  }
}
