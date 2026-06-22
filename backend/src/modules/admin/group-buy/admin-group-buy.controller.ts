import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { Public } from '../../../common/decorators/public.decorator';
import { AuditLog } from '../common/decorators/audit-action';
import { RequirePermission } from '../common/decorators/require-permission';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import {
  CreateGroupBuyActivityDto,
  UpdateGroupBuyActivityDto,
  UpdateGroupBuyActivityStatusDto,
  UpdateGroupBuySettingsDto,
} from './admin-group-buy.dto';
import { AdminGroupBuyService } from './admin-group-buy.service';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/group-buy')
export class AdminGroupBuyController {
  constructor(private groupBuyService: AdminGroupBuyService) {}

  /** 团购活动列表 */
  @Get('activities')
  @RequirePermission('group_buy:read')
  findActivities(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ) {
    return this.groupBuyService.findAll({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      keyword,
      status,
    });
  }

  /** 团购活动详情 */
  @Get('activities/:id')
  @RequirePermission('group_buy:read')
  findActivity(@Param('id') id: string) {
    return this.groupBuyService.findOne(id);
  }

  /** 创建团购活动 */
  @Post('activities')
  @RequirePermission('group_buy:manage')
  @AuditLog({
    action: 'CREATE',
    module: 'group_buy',
    targetType: 'GroupBuyActivity',
    isReversible: false,
  })
  createActivity(@Body() dto: CreateGroupBuyActivityDto) {
    return this.groupBuyService.create(dto);
  }

  /** 更新团购活动 */
  @Patch('activities/:id')
  @RequirePermission('group_buy:manage')
  @AuditLog({
    action: 'UPDATE',
    module: 'group_buy',
    targetType: 'GroupBuyActivity',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  updateActivity(
    @Param('id') id: string,
    @Body() dto: UpdateGroupBuyActivityDto,
  ) {
    return this.groupBuyService.update(id, dto);
  }

  /** 更新团购活动状态 */
  @Patch('activities/:id/status')
  @RequirePermission('group_buy:manage')
  @AuditLog({
    action: 'UPDATE',
    module: 'group_buy',
    targetType: 'GroupBuyActivity',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  updateActivityStatus(
    @Param('id') id: string,
    @Body() dto: UpdateGroupBuyActivityStatusDto,
  ) {
    return this.groupBuyService.updateStatus(id, dto.status);
  }

  /** 删除团购活动（软删除） */
  @Delete('activities/:id')
  @RequirePermission('group_buy:manage')
  @AuditLog({
    action: 'DELETE',
    module: 'group_buy',
    targetType: 'GroupBuyActivity',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  deleteActivity(@Param('id') id: string) {
    return this.groupBuyService.softDelete(id);
  }

  /** 团购设置 */
  @Get('settings')
  @RequirePermission('group_buy:settings')
  getSettings() {
    return this.groupBuyService.getSettings();
  }

  /** 更新团购设置 */
  @Put('settings')
  @RequirePermission('group_buy:settings')
  @AuditLog({
    action: 'CONFIG_CHANGE',
    module: 'group_buy',
    targetType: 'RuleConfig',
    isReversible: true,
  })
  updateSettings(@Body() dto: UpdateGroupBuySettingsDto) {
    return this.groupBuyService.updateSettings(dto);
  }

  /** 团购记录列表 */
  @Get('instances')
  @RequirePermission('group_buy:read')
  findInstances(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('activityId') activityId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.groupBuyService.findInstances({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      keyword,
      status,
      activityId,
      userId,
    });
  }

  /** 团购记录详情 */
  @Get('instances/:id')
  @RequirePermission('group_buy:read')
  findInstance(@Param('id') id: string) {
    return this.groupBuyService.findInstance(id);
  }

  /** 团购订单列表 */
  @Get('orders')
  @RequirePermission('group_buy:read')
  findOrders(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('activityId') activityId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.groupBuyService.findOrders({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      keyword,
      status,
      activityId,
      userId,
    });
  }

  /** 团购返还流水 */
  @Get('rebate-ledgers')
  @RequirePermission('group_buy:read')
  findRebateLedgers(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('instanceId') instanceId?: string,
  ) {
    return this.groupBuyService.findRebateLedgers({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      keyword,
      type,
      status,
      userId,
      instanceId,
    });
  }
}
