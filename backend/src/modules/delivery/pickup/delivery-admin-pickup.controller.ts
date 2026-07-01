import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliveryAdminPermission } from '../auth/decorators/require-delivery-admin-permission.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from '../auth/guards/delivery-admin-permission.guard';
import { DeliveryPickupService } from './delivery-pickup.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard, DeliveryAdminPermissionGuard)
@Controller('delivery-admin')
export class DeliveryAdminPickupController {
  constructor(private readonly deliveryPickupService: DeliveryPickupService) {}

  @Get('freight/dashboard')
  @RequireDeliveryAdminPermission('delivery:orders:read')
  getDashboard(@Query() query: Record<string, string>) {
    return this.deliveryPickupService.getFreightDashboard(query);
  }

  @Get('freight/batches')
  @RequireDeliveryAdminPermission('delivery:orders:read')
  listFreightBatches(@Query() query: Record<string, string>) {
    return this.deliveryPickupService.listAdminPickupBatches(query);
  }

  @Get('pickup-batches')
  @RequireDeliveryAdminPermission('delivery:orders:read')
  listPickupBatches(@Query() query: Record<string, string>) {
    return this.deliveryPickupService.listAdminPickupBatches(query);
  }

  @Post('pickup-batches/:id/call-huolala')
  @RequireDeliveryAdminPermission('delivery:orders:write')
  callHuolala(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryPickupService.callHuolala(id, deliveryAdminUserId);
  }

  @Post('pickup-batches/:id/sync-carrier')
  @RequireDeliveryAdminPermission('delivery:orders:write')
  syncCarrier(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryPickupService.syncCarrier(id, deliveryAdminUserId);
  }

  @Post('pickup-batches/:id/cancel-carrier')
  @RequireDeliveryAdminPermission('delivery:orders:write')
  cancelCarrier(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.deliveryPickupService.cancelCarrier(id, deliveryAdminUserId, reason ?? '');
  }

  @Post('pickup-batches/:id/manual-adjust-cost')
  @RequireDeliveryAdminPermission('delivery:orders:write')
  manualAdjustCost(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
    @Body('amountCents') amountCents?: number | string,
    @Body('remark') remark?: string,
  ) {
    return this.deliveryPickupService.manualAdjustCost(
      id,
      deliveryAdminUserId,
      typeof amountCents === 'string' ? parseInt(amountCents, 10) : Number(amountCents),
      remark ?? '',
    );
  }
}
