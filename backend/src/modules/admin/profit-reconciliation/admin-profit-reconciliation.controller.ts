import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AuditLog } from '../common/decorators/audit-action';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { RequirePermission } from '../common/decorators/require-permission';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import {
  ListProfitAdjustmentsDto,
  ListProfitReconciliationsDto,
  RecalculateProfitDto,
  ReviewProfitDto,
} from './admin-profit-reconciliation.dto';
import { AdminProfitReconciliationService } from './admin-profit-reconciliation.service';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/profit-reconciliation')
export class AdminProfitReconciliationController {
  constructor(private readonly service: AdminProfitReconciliationService) {}

  @Get()
  @RequirePermission('captain:read')
  list(@Query() query: ListProfitReconciliationsDto) {
    return this.service.listReconciliations(query);
  }

  @Get(':id')
  @RequirePermission('captain:read')
  detail(@Param('id') id: string) {
    return this.service.getReconciliation(id);
  }

  @Post(':id/recalculate')
  @RequirePermission('captain:manage')
  @AuditLog({
    action: 'UPDATE',
    module: 'profit-reconciliation',
    targetType: 'OrderProfitReconciliationTask',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  recalculate(
    @Param('id') id: string,
    @CurrentAdmin('sub') adminId: string,
    @Body() dto: RecalculateProfitDto,
  ) {
    return this.service.recalculate(id, adminId, dto);
  }

  @Post(':id/reject')
  @RequirePermission('captain:manage')
  @AuditLog({
    action: 'REJECT',
    module: 'profit-reconciliation',
    targetType: 'OrderProfitReconciliationTask',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  reject(
    @Param('id') id: string,
    @CurrentAdmin('sub') adminId: string,
    @Body() dto: ReviewProfitDto,
  ) {
    return this.service.rejectReconciliation(id, adminId, dto);
  }
}

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/profit-adjustments')
export class AdminProfitAdjustmentController {
  constructor(private readonly service: AdminProfitReconciliationService) {}

  @Get()
  @RequirePermission('captain:read')
  list(@Query() query: ListProfitAdjustmentsDto) {
    return this.service.listAdjustments(query);
  }

  @Get(':id')
  @RequirePermission('captain:read')
  detail(@Param('id') id: string) {
    return this.service.getAdjustment(id);
  }

  @Post(':id/approve-and-apply')
  @RequirePermission('captain:settlement')
  @AuditLog({
    action: 'APPROVE',
    module: 'profit-adjustment',
    targetType: 'OrderProfitAdjustmentDraft',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  approveAndApply(
    @Param('id') id: string,
    @CurrentAdmin('sub') adminId: string,
    @Body() dto: ReviewProfitDto,
  ) {
    return this.service.approveAndApplyAdjustment(id, adminId, dto);
  }

  @Post(':id/reject')
  @RequirePermission('captain:settlement')
  @AuditLog({
    action: 'REJECT',
    module: 'profit-adjustment',
    targetType: 'OrderProfitAdjustmentDraft',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  reject(
    @Param('id') id: string,
    @CurrentAdmin('sub') adminId: string,
    @Body() dto: ReviewProfitDto,
  ) {
    return this.service.rejectAdjustment(id, adminId, dto);
  }
}
