import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AuditLog } from '../admin/common/decorators/audit-action';
import { CurrentAdmin } from '../admin/common/decorators/current-admin';
import { RequirePermission } from '../admin/common/decorators/require-permission';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import { AuditLogInterceptor } from '../admin/common/interceptors/audit-log.interceptor';
import { ProductMediaRevisionsService } from './product-media-revisions.service';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/product-media-revisions')
export class AdminProductMediaRevisionsController {
  constructor(private readonly revisions: ProductMediaRevisionsService) {}

  @Get()
  @RequirePermission('products:audit')
  listPending() {
    return this.revisions.listPendingForAdmin();
  }

  @Get(':id')
  @RequirePermission('products:audit')
  getForAdmin(@Param('id') id: string) {
    return this.revisions.getForAdmin(id);
  }

  @Post(':id/approve')
  @RequirePermission('products:audit')
  @AuditLog({ action: 'APPROVE', module: 'product-images', targetType: 'ProductMediaRevision', targetIdParam: 'params.id', isReversible: false })
  approve(@Param('id') id: string, @CurrentAdmin('sub') adminUserId: string) {
    return this.revisions.approve(id, adminUserId);
  }

  @Post(':id/reject')
  @RequirePermission('products:audit')
  @AuditLog({ action: 'REJECT', module: 'product-images', targetType: 'ProductMediaRevision', targetIdParam: 'params.id', isReversible: false })
  reject(@Param('id') id: string, @CurrentAdmin('sub') adminUserId: string, @Body('reviewNote') reviewNote: string) {
    return this.revisions.reject(id, adminUserId, reviewNote || '');
  }
}
