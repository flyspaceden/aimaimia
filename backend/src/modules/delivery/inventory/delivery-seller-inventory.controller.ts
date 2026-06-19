import { Body, Controller, Patch, Param, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { UpdateDeliverySkuStockDto } from './dto/update-delivery-sku-stock.dto';
import { DeliveryInventoryService } from './delivery-inventory.service';

@Public()
@UseGuards(DeliverySellerAuthGuard)
@Controller('delivery-seller/skus')
export class DeliverySellerInventoryController {
  constructor(private readonly deliveryInventoryService: DeliveryInventoryService) {}

  @Patch(':id/stock')
  updateStock(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @Param('id') skuId: string,
    @Body() dto: UpdateDeliverySkuStockDto,
  ) {
    return this.deliveryInventoryService.updateSellerSkuStock(
      merchantId,
      deliverySellerStaffId,
      skuId,
      dto,
    );
  }
}
