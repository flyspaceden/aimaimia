import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminMerchantApplicationsService } from './admin-merchant-applications.service';
import { RejectMerchantApplicationDto } from '../../merchant-application/dto/reject-merchant-application.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { CurrentAdmin } from '../common/decorators/current-admin';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/merchant-applications')
export class AdminMerchantApplicationsController {
  constructor(
    private readonly service: AdminMerchantApplicationsService,
  ) {}

  @Get()
  @RequirePermission('companies:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.service.findAll(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
      keyword,
    );
  }

  @Get('pending-count')
  @RequirePermission('companies:read')
  getPendingCount() {
    return this.service.getPendingCount();
  }

  @Get(':id')
  @RequirePermission('companies:read')
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post(':id/approve')
  @RequirePermission('companies:audit')
  @AuditLog({
    action: 'APPROVE',
    module: 'merchant-applications',
    targetType: 'MerchantApplication',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  approve(
    @Param('id') id: string,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.service.approve(id, adminId);
  }

  @Post(':id/reject')
  @RequirePermission('companies:audit')
  @AuditLog({
    action: 'REJECT',
    module: 'merchant-applications',
    targetType: 'MerchantApplication',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectMerchantApplicationDto,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.service.reject(id, dto, adminId);
  }
}
