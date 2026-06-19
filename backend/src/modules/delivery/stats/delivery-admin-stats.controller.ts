import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { DeliveryAdminAuthGuard } from '../auth/guards/delivery-admin-auth.guard';
import { DeliveryStatsService } from './delivery-stats.service';

@Public()
@UseGuards(DeliveryAdminAuthGuard)
@Controller('delivery-admin/stats')
export class DeliveryAdminStatsController {
  constructor(private readonly deliveryStatsService: DeliveryStatsService) {}

  @Get()
  getStats() {
    return this.deliveryStatsService.getAdminStats();
  }
}
