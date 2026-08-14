import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentAdmin } from '../admin/common/decorators/current-admin';
import { RequirePermission } from '../admin/common/decorators/require-permission';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import {
  AdminCreatePickupPointDto,
  AdminPickupCompanyOptionQueryDto,
  AdminPickupPointQueryDto,
  AdminPickupPointReasonDto,
  AdminUpdatePickupPointDto,
} from './dto/pickup-point.dto';
import { AdminPointAuditContext, PickupService } from './pickup.service';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@Controller('admin/pickup-points')
export class PickupAdminPointController {
  constructor(private readonly pickupService: PickupService) {}

  @RequirePermission('pickup_points:read')
  @Get('company-options')
  companyOptions(@Query() query: AdminPickupCompanyOptionQueryDto) {
    return this.pickupService.listAdminPickupCompanyOptions(query.keyword);
  }

  @RequirePermission('pickup_points:read')
  @Get()
  list(@Query() query: AdminPickupPointQueryDto) {
    return this.pickupService.listAdminPoints(query);
  }

  @RequirePermission('pickup_points:create')
  @Post()
  create(
    @Body() dto: AdminCreatePickupPointDto,
    @CurrentAdmin('sub') adminUserId: string,
    @Req() request: Request,
  ) {
    return this.pickupService.createAdminPoint(
      dto,
      this.auditContext(adminUserId, request),
    );
  }

  @RequirePermission('pickup_points:update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: AdminUpdatePickupPointDto,
    @CurrentAdmin('sub') adminUserId: string,
    @Req() request: Request,
  ) {
    return this.pickupService.updateAdminPoint(
      id,
      dto,
      this.auditContext(adminUserId, request),
    );
  }

  @RequirePermission('pickup_points:delete')
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Body() dto: AdminPickupPointReasonDto,
    @CurrentAdmin('sub') adminUserId: string,
    @Req() request: Request,
  ) {
    return this.pickupService.deleteAdminPoint(
      id,
      dto.reason,
      this.auditContext(adminUserId, request),
    );
  }

  @RequirePermission('pickup_points:delete')
  @Post(':id/restore')
  restore(
    @Param('id') id: string,
    @Body() dto: AdminPickupPointReasonDto,
    @CurrentAdmin('sub') adminUserId: string,
    @Req() request: Request,
  ) {
    return this.pickupService.restoreAdminPoint(
      id,
      dto.reason,
      this.auditContext(adminUserId, request),
    );
  }

  private auditContext(adminUserId: string, request: Request): AdminPointAuditContext {
    const requestIdHeader = request.headers['x-request-id'];
    return {
      adminUserId,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader,
    };
  }
}

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@Controller('admin/orders')
export class PickupAdminOrderController {
  constructor(private readonly pickupService: PickupService) {}

  @RequirePermission('orders:read')
  @Get(':id/pickup-events')
  events(@Param('id') id: string) {
    return this.pickupService.listAdminEvents(id);
  }
}
