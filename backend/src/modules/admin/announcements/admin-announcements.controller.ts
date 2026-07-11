import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { AuditLog } from '../common/decorators/audit-action';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { AdminAnnouncementsService } from './admin-announcements.service';
import {
  AnnouncementListQueryDto,
  AnnouncementTargetProductQueryDto,
  CreateAnnouncementDto,
} from './dto/admin-announcement.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly announcementsService: AdminAnnouncementsService) {}

  @Get()
  @RequirePermission('announcements:read')
  findAll(@Query() query: AnnouncementListQueryDto) {
    return this.announcementsService.findAll(query);
  }

  @Get('target-products')
  @RequirePermission('announcements:read')
  findTargetProducts(@Query() query: AnnouncementTargetProductQueryDto) {
    return this.announcementsService.findTargetProducts(query);
  }

  @Get(':id')
  @RequirePermission('announcements:read')
  findById(@Param('id') id: string) {
    return this.announcementsService.findById(id);
  }

  @Post('preview')
  @RequirePermission('announcements:read')
  preview(@Body() dto: CreateAnnouncementDto) {
    return this.announcementsService.preview(dto);
  }

  @Post()
  @RequirePermission('announcements:create')
  @AuditLog({
    action: 'CREATE',
    module: 'announcements',
    targetType: 'Announcement',
    isReversible: false,
  })
  create(@Body() dto: CreateAnnouncementDto, @CurrentAdmin('sub') adminId: string) {
    return this.announcementsService.create(dto, adminId);
  }
}
