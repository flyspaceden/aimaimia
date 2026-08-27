import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AuditLog } from '../admin/common/decorators/audit-action';
import { CurrentAdmin } from '../admin/common/decorators/current-admin';
import { RequirePermission } from '../admin/common/decorators/require-permission';
import { AdminAuthGuard } from '../admin/common/guards/admin-auth.guard';
import { PermissionGuard } from '../admin/common/guards/permission.guard';
import { AuditLogInterceptor } from '../admin/common/interceptors/audit-log.interceptor';
import { ProductPaidVisualCandidateService } from './product-paid-visual-candidate.service';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/product-paid-visual-candidates')
export class AdminProductPaidVisualCandidatesController {
  constructor(private readonly candidates: ProductPaidVisualCandidateService) {}

  @Get(':id')
  @RequirePermission('products:audit')
  get(@Param('id') id: string) {
    return this.candidates.getForAdmin(id);
  }

  @Post(':id/approve-facts')
  @RequirePermission('products:audit')
  @AuditLog({ action: 'APPROVE', module: 'product-images', targetType: 'ProductImageOptimization', targetIdParam: 'params.id', isReversible: false })
  async approve(@Param('id') id: string, @CurrentAdmin('sub') _adminId: string) {
    await this.candidates.approveHumanFactReview(id);
    return { approved: true };
  }

  @Post(':id/reject-facts')
  @RequirePermission('products:audit')
  @AuditLog({ action: 'REJECT', module: 'product-images', targetType: 'ProductImageOptimization', targetIdParam: 'params.id', isReversible: false, reasonBodyField: 'reason' })
  async reject(@Param('id') id: string, @Body('reason') reason: string, @CurrentAdmin('sub') _adminId: string) {
    await this.candidates.rejectHumanFactReview(id, reason || '');
    return { rejected: true };
  }
}
