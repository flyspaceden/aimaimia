import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { AdminReconciliationService } from './admin-reconciliation.service';
import { AdminReconciliationQueryDto } from './dto/admin-reconciliation.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@Controller('admin/reconciliation')
export class AdminReconciliationController {
  constructor(private readonly reconciliationService: AdminReconciliationService) {}

  /** 日对账报表（默认当天；传 date=YYYY-MM-DD 可指定日期） */
  @Get('daily')
  @RequirePermission('bonus:read')
  getDaily(@Query() query: AdminReconciliationQueryDto) {
    return this.reconciliationService.getDailyReport(query.date);
  }

  /** 手动触发日对账（建议仅财务/高权限管理员使用） */
  @Post('daily/run')
  @RequirePermission('bonus:approve_withdraw')
  runDaily(
    @Query() query: AdminReconciliationQueryDto,
    @CurrentAdmin('sub') adminUserId?: string,
  ) {
    return this.reconciliationService.runDailyReport(query.date, adminUserId);
  }
}

