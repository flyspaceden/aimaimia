import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { RequireDeliveryAdminPermission } from '../auth/decorators/require-delivery-admin-permission.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryAdminPermissionGuard } from '../auth/guards/delivery-admin-permission.guard';
import { DeliveryStatsService } from './delivery-stats.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard, DeliveryAdminPermissionGuard)
@Controller('delivery-admin/stats')
export class DeliveryAdminStatsController {
  constructor(private readonly deliveryStatsService: DeliveryStatsService) {}

  @Get()
  @RequireDeliveryAdminPermission('delivery:dashboard:read')
  getStats() {
    return this.deliveryStatsService.getAdminStats();
  }
}
