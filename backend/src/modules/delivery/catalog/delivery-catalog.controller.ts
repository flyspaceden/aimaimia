import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryUserAuthGuard } from '../auth/guards/delivery-user-auth.guard';
import { ListDeliveryCatalogProductsQueryDto } from './dto/list-delivery-catalog-products.query.dto';
import { DeliveryCatalogService } from './delivery-catalog.service';

@Public()
@UseGuards(DeliveryUserAuthGuard)
@Controller('delivery')
export class DeliveryCatalogController {
  constructor(private readonly deliveryCatalogService: DeliveryCatalogService) {}

  @Get('categories')
  listCategories() {
    return this.deliveryCatalogService.listCategories();
  }

  @Get('products')
  listProducts(@Query() query: ListDeliveryCatalogProductsQueryDto) {
    return this.deliveryCatalogService.listProducts(query);
  }

  @Get('products/:id')
  getProductDetail(@Param('id') id: string, @Query() query: ListDeliveryCatalogProductsQueryDto) {
    return this.deliveryCatalogService.getProductDetail(id, query.quantity ?? 1);
  }
}
