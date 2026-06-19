import { Body, Controller, Get, Patch, Post, Param, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import {
  CreateAdminDeliveryProductDto,
} from './dto/create-delivery-product.dto';
import { ListDeliveryProductsQueryDto } from './dto/list-delivery-products.query.dto';
import { ReviewDeliveryProductDto } from './dto/review-delivery-product.dto';
import { UpdateDeliveryProductDto } from './dto/update-delivery-product.dto';
import { DeliveryProductsService } from './delivery-products.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard)
@Controller('delivery-admin/products')
export class DeliveryAdminProductsController {
  constructor(private readonly deliveryProductsService: DeliveryProductsService) {}

  @Get()
  list(@Query() query: ListDeliveryProductsQueryDto) {
    return this.deliveryProductsService.listAdminProducts(query);
  }

  @Post()
  create(@Body() dto: CreateAdminDeliveryProductDto) {
    return this.deliveryProductsService.createAdminProduct(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeliveryProductDto) {
    return this.deliveryProductsService.updateAdminProduct(id, dto);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ReviewDeliveryProductDto) {
    return this.deliveryProductsService.approveAdminProduct(id, dto.note);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: ReviewDeliveryProductDto) {
    return this.deliveryProductsService.rejectAdminProduct(id, dto.note);
  }
}
