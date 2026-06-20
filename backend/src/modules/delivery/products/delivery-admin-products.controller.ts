import { Body, Controller, Get, Patch, Post, Param, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliveryAdminPermission } from '../auth/decorators/require-delivery-admin-permission.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from '../auth/guards/delivery-admin-permission.guard';
import {
  CreateAdminDeliveryProductDto,
} from './dto/create-delivery-product.dto';
import { ListDeliveryProductsQueryDto } from './dto/list-delivery-products.query.dto';
import { ReviewDeliveryProductDto } from './dto/review-delivery-product.dto';
import { UpdateDeliveryProductDto } from './dto/update-delivery-product.dto';
import { DeliveryProductsService } from './delivery-products.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard, DeliveryAdminPermissionGuard)
@Controller('delivery-admin/products')
export class DeliveryAdminProductsController {
  constructor(private readonly deliveryProductsService: DeliveryProductsService) {}

  @Get()
  @RequireDeliveryAdminPermission('delivery:products:read')
  list(@Query() query: ListDeliveryProductsQueryDto) {
    return this.deliveryProductsService.listAdminProducts(query);
  }

  @Post()
  @RequireDeliveryAdminPermission('delivery:products:write')
  create(@Body() dto: CreateAdminDeliveryProductDto) {
    return this.deliveryProductsService.createAdminProduct(dto);
  }

  @Patch(':id')
  @RequireDeliveryAdminPermission('delivery:products:write')
  update(@Param('id') id: string, @Body() dto: UpdateDeliveryProductDto) {
    return this.deliveryProductsService.updateAdminProduct(id, dto);
  }

  @Post(':id/approve')
  @RequireDeliveryAdminPermission('delivery:products:audit')
  approve(@Param('id') id: string, @Body() dto: ReviewDeliveryProductDto) {
    return this.deliveryProductsService.approveAdminProduct(id, dto.note);
  }

  @Post(':id/reject')
  @RequireDeliveryAdminPermission('delivery:products:audit')
  reject(@Param('id') id: string, @Body() dto: ReviewDeliveryProductDto) {
    return this.deliveryProductsService.rejectAdminProduct(id, dto.note);
  }
}
