import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminStatsService } from './admin-stats.service';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@Controller('admin/stats')
export class AdminStatsController {
  constructor(private statsService: AdminStatsService) {}

  @Get('dashboard')
  @RequirePermission('dashboard:read')
  getDashboard() {
    return this.statsService.getDashboard();
  }

  @Get('sales-trend')
  @RequirePermission('dashboard:read')
  getSalesTrend() {
    return this.statsService.getSalesTrend();
  }

  @Get('bonus')
  @RequirePermission('dashboard:read')
  getBonusStats() {
    return this.statsService.getBonusStats();
  }
}
