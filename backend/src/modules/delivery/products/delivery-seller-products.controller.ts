import { Body, Controller, Get, Patch, Post, Param, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireDeliverySellerPermission } from '../auth/decorators/require-delivery-seller-permission.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { DeliverySellerPermissionGuard } from '../auth/guards/delivery-seller-permission.guard';
import { CreateDeliverySellerProductDto } from './dto/create-delivery-seller-product.dto';
import { ListDeliveryProductsQueryDto } from './dto/list-delivery-products.query.dto';
import { UpdateDeliverySellerProductDto } from './dto/update-delivery-seller-product.dto';
import { DeliveryProductsService } from './delivery-products.service';

@Public()
@UseGuards(DeliverySellerAuthGuard, DeliverySellerPermissionGuard)
@Controller('delivery-seller/products')
export class DeliverySellerProductsController {
  constructor(private readonly deliveryProductsService: DeliveryProductsService) {}

  @Get()
  @RequireDeliverySellerPermission('products:read')
  list(
    @CurrentUser('merchantId') merchantId: string,
    @Query() query: ListDeliveryProductsQueryDto,
  ) {
    return this.deliveryProductsService.listSellerProducts(merchantId, query);
  }

  @Get(':id')
  @RequireDeliverySellerPermission('products:read')
  getOne(@CurrentUser('merchantId') merchantId: string, @Param('id') id: string) {
    return this.deliveryProductsService.getSellerProduct(merchantId, id);
  }

  @Post()
  @RequireDeliverySellerPermission('products:write')
  create(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @Body() dto: CreateDeliverySellerProductDto,
  ) {
    return this.deliveryProductsService.createSellerProduct(merchantId, deliverySellerStaffId, dto);
  }

  @Patch(':id')
  @RequireDeliverySellerPermission('products:write')
  update(
    @CurrentUser('merchantId') merchantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliverySellerProductDto,
  ) {
    return this.deliveryProductsService.updateSellerProduct(merchantId, id, dto);
  }

  @Post(':id/submit')
  @RequireDeliverySellerPermission('products:write')
  submit(@CurrentUser('merchantId') merchantId: string, @Param('id') id: string) {
    return this.deliveryProductsService.submitSellerProduct(merchantId, id);
  }
}
