import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CouponService } from '../../coupon/coupon.service';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { CreateCampaignDto } from '../../coupon/dto/create-campaign.dto';
import { UpdateCampaignDto, UpdateCampaignStatusDto } from '../../coupon/dto/update-campaign.dto';
import { ManualIssueDto } from '../../coupon/dto/manual-issue.dto';

/**
 * 管理端红包控制器
 *
 * 使用 @Public() 绕过全局买家 JwtAuthGuard，
 * 再显式使用 AdminAuthGuard + PermissionGuard 进行管理员认证鉴权。
 */
@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/coupons')
export class AdminCouponController {
  constructor(private couponService: CouponService) {}

  // ========== 活动管理 ==========

  /** 红包活动列表（分页、筛选） */
  @Get('campaigns')
  @RequirePermission('coupon:read')
  getCampaigns(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('triggerType') triggerType?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.couponService.getCampaigns({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      status,
      triggerType,
      keyword,
    });
  }

  /** 创建红包活动 */
  @Post('campaigns')
  @RequirePermission('coupon:manage')
  @AuditLog({
    action: 'CREATE',
    module: 'coupon',
    targetType: 'CouponCampaign',
    isReversible: false,
  })
  createCampaign(
    @Body() dto: CreateCampaignDto,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.couponService.createCampaign(dto, adminId);
  }

  /** 活动详情 */
  @Get('campaigns/:id')
  @RequirePermission('coupon:read')
  getCampaignById(@Param('id') id: string) {
    return this.couponService.getCampaignById(id);
  }

  /** 编辑活动 */
  @Patch('campaigns/:id')
  @RequirePermission('coupon:manage')
  @AuditLog({
    action: 'UPDATE',
    module: 'coupon',
    targetType: 'CouponCampaign',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  updateCampaign(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.couponService.updateCampaign(id, dto);
  }

  /** 上下架（状态变更：ACTIVE/PAUSED/ENDED） */
  @Patch('campaigns/:id/status')
  @RequirePermission('coupon:manage')
  @AuditLog({
    action: 'UPDATE',
    module: 'coupon',
    targetType: 'CouponCampaign',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  updateCampaignStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignStatusDto,
  ) {
    return this.couponService.updateCampaignStatus(id, dto.status);
  }

  // ========== 发放与使用记录 ==========

  /** 活动发放记录（谁领了） */
  @Get('campaigns/:id/instances')
  @RequirePermission('coupon:read')
  getCampaignInstances(
    @Param('id') campaignId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.couponService.getCampaignInstances(campaignId, {
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      status,
    });
  }

  /** 全局发放记录 */
  @Get('instances')
  @RequirePermission('coupon:read')
  getInstances(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
  ) {
    return this.couponService.getInstances({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      status,
      userId,
    });
  }

  /** 活动使用记录（用在哪笔订单） */
  @Get('campaigns/:id/usage')
  @RequirePermission('coupon:read')
  getCampaignUsage(
    @Param('id') campaignId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.couponService.getCampaignUsage(campaignId, {
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }

  /** 全局使用记录 */
  @Get('usage')
  @RequirePermission('coupon:read')
  getUsageRecords(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('orderId') orderId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.couponService.getUsageRecords({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      orderId,
      userId,
    });
  }

  /** 手动发放给指定用户 */
  @Post('campaigns/:id/manual-issue')
  @RequirePermission('coupon:manage')
  @AuditLog({
    action: 'CREATE',
    module: 'coupon',
    targetType: 'CouponInstance',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  manualIssue(
    @Param('id') campaignId: string,
    @Body() dto: ManualIssueDto,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.couponService.manualIssue(campaignId, dto.userIds, adminId);
  }

  /** 撤回红包实例 */
  @Post('instances/:instanceId/revoke')
  @RequirePermission('coupon:manage')
  @AuditLog({
    action: 'UPDATE',
    module: 'coupon',
    targetType: 'CouponInstance',
    targetIdParam: 'params.instanceId',
    isReversible: false,
  })
  revokeInstance(@Param('instanceId') instanceId: string) {
    return this.couponService.revokeInstance(instanceId);
  }

  // ========== 数据统计 ==========

  /** 红包数据统计总览 */
  @Get('stats')
  @RequirePermission('coupon:read')
  getStats() {
    return this.couponService.getStats();
  }

  /** 单个活动统计 */
  @Get('stats/:campaignId')
  @RequirePermission('coupon:read')
  getCampaignStats(@Param('campaignId') campaignId: string) {
    return this.couponService.getCampaignStats(campaignId);
  }
}
