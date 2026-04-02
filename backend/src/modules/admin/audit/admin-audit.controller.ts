import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminAuditService } from './admin-audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { CurrentAdmin } from '../common/decorators/current-admin';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private auditService: AdminAuditService) {}

  @Get()
  @RequirePermission('audit:read')
  findAll(
    @Query() query: AuditQueryDto,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.auditService.findAll(
      query,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get(':id')
  @RequirePermission('audit:read')
  findById(@Param('id') id: string) {
    return this.auditService.findById(id);
  }

  @Get('target/:targetType/:targetId')
  @RequirePermission('audit:read')
  findByTarget(
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string,
  ) {
    return this.auditService.findByTarget(targetType, targetId);
  }

  @Post(':id/rollback')
  @RequirePermission('audit:rollback')
  rollback(
    @Param('id') id: string,
    @CurrentAdmin('sub') adminUserId: string,
    @Req() req: Request,
  ) {
    return this.auditService.rollback(id, adminUserId, req.ip);
  }
}
