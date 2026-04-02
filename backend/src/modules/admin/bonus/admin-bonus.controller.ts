import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminBonusService } from './admin-bonus.service';
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
@Controller('admin/bonus')
export class AdminBonusController {
  constructor(private bonusService: AdminBonusService) {}

  @Get('members')
  @RequirePermission('bonus:read')
  findMembers(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('tier') tier?: string,
  ) {
    return this.bonusService.findMembers(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      tier,
    );
  }

  @Get('members/:userId')
  @RequirePermission('bonus:read')
  getMemberDetail(@Param('userId') userId: string) {
    return this.bonusService.getMemberDetail(userId);
  }

  @Get('withdrawals')
  @RequirePermission('bonus:read')
  findWithdrawals(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.bonusService.findWithdrawals(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
    );
  }

  // ============ VIP 树可视化 ============

  @Get('vip-tree/search')
  @RequirePermission('bonus:read')
  searchUsers(@Query('keyword') keyword: string) {
    return this.bonusService.searchUsers(keyword || '');
  }

  @Get('vip-tree/root-stats')
  @RequirePermission('bonus:read')
  getVipRootStats() {
    return this.bonusService.getVipRootStats();
  }

  @Get('vip-tree/context')
  @RequirePermission('bonus:read')
  getVipTreeContext(
    @Query('userId') userId: string,
    @Query('descendantDepth') depth?: string,
  ) {
    if (!userId) throw new BadRequestException('userId 参数必填');
    return this.bonusService.getVipTreeContext(userId, depth ? parseInt(depth) : 1);
  }

  @Get('vip-tree/:userId/reward-records')
  @RequirePermission('bonus:read')
  getVipTreeRewardRecords(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.bonusService.getTreeRewardRecords(
      userId,
      'VIP_REWARD',
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get('vip-tree/:userId/orders')
  @RequirePermission('bonus:read')
  getVipTreeRelatedOrders(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.bonusService.getTreeRelatedOrders(
      userId,
      'VIP_REWARD',
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get('vip-tree/:userId/path-explain')
  @RequirePermission('bonus:read')
  getVipPathExplain(
    @Param('userId') userId: string,
    @Query('ledgerId') ledgerId: string,
  ) {
    return this.bonusService.getPathExplain(userId, ledgerId, 'VIP_REWARD');
  }

  @Get('vip-tree/:userId/children')
  @RequirePermission('bonus:read')
  getVipTreeChildren(@Param('userId') userId: string) {
    return this.bonusService.getVipTreeChildren(userId);
  }

  // ============ 普通用户树可视化 ============

  @Get('normal-tree/search')
  @RequirePermission('bonus:read')
  searchNormalTreeUsers(@Query('keyword') keyword: string) {
    return this.bonusService.searchNormalTreeUsers(keyword || '');
  }

  @Get('normal-tree/root-stats')
  @RequirePermission('bonus:read')
  getNormalRootStats() {
    return this.bonusService.getNormalRootStats();
  }

  @Get('normal-tree/context')
  @RequirePermission('bonus:read')
  getNormalTreeContext(
    @Query('userId') userId: string,
    @Query('descendantDepth') depth?: string,
  ) {
    if (!userId) throw new BadRequestException('userId 参数必填');
    return this.bonusService.getNormalTreeContext(userId, depth ? parseInt(depth) : 1);
  }

  @Get('normal-tree/:userId/reward-records')
  @RequirePermission('bonus:read')
  getNormalTreeRewardRecords(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.bonusService.getTreeRewardRecords(
      userId,
      'NORMAL_REWARD',
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get('normal-tree/:userId/orders')
  @RequirePermission('bonus:read')
  getNormalTreeRelatedOrders(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.bonusService.getTreeRelatedOrders(
      userId,
      'NORMAL_REWARD',
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get('normal-tree/:userId/path-explain')
  @RequirePermission('bonus:read')
  getNormalPathExplain(
    @Param('userId') userId: string,
    @Query('ledgerId') ledgerId: string,
  ) {
    return this.bonusService.getPathExplain(userId, ledgerId, 'NORMAL_REWARD');
  }

  @Get('normal-tree/:userId/children')
  @RequirePermission('bonus:read')
  getNormalTreeChildren(@Param('userId') userId: string) {
    return this.bonusService.getNormalTreeChildren(userId);
  }

  // ============ 普通奖励滑动窗口 ============

  @Get('broadcast-window/buckets')
  @RequirePermission('bonus:read')
  getBroadcastBuckets() {
    return this.bonusService.getBroadcastBuckets();
  }

  @Get('broadcast-window')
  @RequirePermission('bonus:read')
  getBroadcastWindow(
    @Query('bucket') bucket: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.bonusService.getBroadcastWindow(
      bucket,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 30,
    );
  }

  @Get('broadcast-window/:orderId/distributions')
  @RequirePermission('bonus:read')
  getBroadcastDistributions(@Param('orderId') orderId: string) {
    return this.bonusService.getBroadcastDistributions(orderId);
  }

  // ============ 提现管理 ============

  @Post('withdrawals/:id/approve')
  @RequirePermission('bonus:approve_withdraw')
  @AuditLog({
    action: 'APPROVE',
    module: 'bonus',
    targetType: 'WithdrawRequest',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  approveWithdraw(
    @Param('id') id: string,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.bonusService.approveWithdraw(id, adminUserId);
  }

  @Post('withdrawals/:id/reject')
  @RequirePermission('bonus:approve_withdraw')
  @AuditLog({
    action: 'REJECT',
    module: 'bonus',
    targetType: 'WithdrawRequest',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  rejectWithdraw(
    @Param('id') id: string,
    @CurrentAdmin('sub') adminUserId: string,
    @Body('reason') reason?: string,
  ) {
    return this.bonusService.rejectWithdraw(id, adminUserId, reason);
  }
}
