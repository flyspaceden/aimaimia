import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminAppUsersService } from './admin-app-users.service';
import { GuestCleanupService } from '../../auth/guest-cleanup.service';
import { ToggleBanDto } from './dto/toggle-ban.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/app-users')
export class AdminAppUsersController {
  constructor(
    private appUsersService: AdminAppUsersService,
    private guestCleanupService: GuestCleanupService,
  ) {}

  @Get()
  @RequirePermission('users:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('tier') tier?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.appUsersService.findAll(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
      keyword,
      tier,
      startDate,
      endDate,
    );
  }

  @Get('stats')
  @RequirePermission('users:read')
  getStats() {
    return this.appUsersService.getStats();
  }

  // ===== 具体路径路由放在 :id 参数路由之前，防止被 :id 抢先匹配 =====

  /** B6: 游客数据清理 — dry-run 预览 */
  @Get('guest-cleanup/preview')
  @RequirePermission('users:delete')
  guestCleanupPreview() {
    return this.guestCleanupService.cleanup(true);
  }

  /** B6: 游客数据清理 — 实际执行 */
  @Post('guest-cleanup/execute')
  @RequirePermission('users:delete')
  @AuditLog({
    action: 'DELETE',
    module: 'users',
    targetType: 'User',
    isReversible: false,
  })
  guestCleanupExecute(@CurrentAdmin('sub') adminUserId: string) {
    return this.guestCleanupService.cleanup(false, adminUserId);
  }

  // ===== 参数路由放在最后 =====

  @Get(':id')
  @RequirePermission('users:read')
  findById(@Param('id') id: string) {
    return this.appUsersService.findById(id);
  }

  @Post(':id/toggle-ban')
  @RequirePermission('users:ban')
  @AuditLog({
    action: 'STATUS_CHANGE',
    module: 'users',
    targetType: 'User',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  toggleBan(
    @Param('id') id: string,
    @Body() dto: ToggleBanDto,
  ) {
    return this.appUsersService.toggleBan(id, dto.status);
  }
}
