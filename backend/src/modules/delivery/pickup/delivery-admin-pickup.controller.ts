import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliveryAdminPermission } from '../auth/decorators/require-delivery-admin-permission.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from '../auth/guards/delivery-admin-permission.guard';
import { DeliveryPickupService } from './delivery-pickup.service';
import { UploadService } from '../../upload/upload.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard, DeliveryAdminPermissionGuard)
@Controller('delivery-admin')
export class DeliveryAdminPickupController {
  constructor(
    private readonly deliveryPickupService: DeliveryPickupService,
    private readonly uploadService: UploadService,
  ) {}

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

  @Post('pickup-batches/:id/reprint-waybill')
  @RequireDeliveryAdminPermission('delivery:orders:write')
  reprintWaybill(
    @CurrentUser('deliveryAdminUserId') deliveryAdminUserId: string,
    @Param('id') id: string,
  ) {
    return this.deliveryPickupService.reprintAdminWaybill(id, deliveryAdminUserId);
  }

  @Get('pickup-batches/:id/waybill-file')
  @RequireDeliveryAdminPermission('delivery:orders:read')
  async downloadWaybill(@Param('id') id: string, @Res() res: Response) {
    const key = await this.deliveryPickupService.getAdminWaybillStorageKey(id);
    const file = await this.uploadService.getFileForDownload(key);
    const basename = file.basename.replace(/[\r\n"\\]/g, '_') || '顺丰面单.pdf';
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="waybill.pdf"; filename*=UTF-8''${encodeURIComponent(basename)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=60');
    if ('filePath' in file) {
      return res.sendFile(file.filePath);
    }
    return file.stream.pipe(res);
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
      amountCents,
      remark ?? '',
    );
  }
}
