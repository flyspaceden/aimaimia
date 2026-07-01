import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliverySellerPermission } from '../auth/decorators/require-delivery-seller-permission.decorator';
import { DeliverySellerAuthGuard } from '../auth/guards/delivery-seller-auth.guard';
import { DeliverySellerPermissionGuard } from '../auth/guards/delivery-seller-permission.guard';
import { DeliveryPickupService } from './delivery-pickup.service';

@Public()
@UseGuards(DeliverySellerAuthGuard, DeliverySellerPermissionGuard)
@Controller('delivery-seller/pickup-batches')
export class DeliverySellerPickupController {
  constructor(private readonly deliveryPickupService: DeliveryPickupService) {}

  @Get()
  @RequireDeliverySellerPermission('orders:read')
  list(
    @CurrentUser('merchantId') merchantId: string,
    @Query() query: Record<string, string>,
  ) {
    return this.deliveryPickupService.listSellerPickupBatches(merchantId, query);
  }

  @Get(':id')
  @RequireDeliverySellerPermission('orders:read')
  detail(
    @CurrentUser('merchantId') merchantId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryPickupService.getSellerPickupBatch(merchantId, id);
  }

  @Post(':id/mark-ready')
  @RequireDeliverySellerPermission('orders:write')
  markReady(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryPickupService.markReady(merchantId, deliverySellerStaffId, id);
  }

  @Post(':id/mark-loaded')
  @RequireDeliverySellerPermission('orders:write')
  markLoaded(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryPickupService.markLoaded(merchantId, deliverySellerStaffId, id);
  }

  @Post(':id/report-exception')
  @RequireDeliverySellerPermission('orders:write')
  reportException(
    @CurrentUser('merchantId') merchantId: string,
    @CurrentUser('deliverySellerStaffId') deliverySellerStaffId: string,
    @Param('id') id: string,
    @Body('message') message?: string,
    @Body('remark') remark?: string,
  ) {
    return this.deliveryPickupService.reportException(
      merchantId,
      deliverySellerStaffId,
      id,
      message ?? remark ?? '',
    );
  }
}
