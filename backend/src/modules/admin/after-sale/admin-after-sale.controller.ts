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
import { AdminAfterSaleService } from './admin-after-sale.service';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { ArbitrateAfterSaleDto } from './dto/arbitrate-after-sale.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/after-sale')
export class AdminAfterSaleController {
  constructor(private afterSaleService: AdminAfterSaleService) {}

  /** 售后申请列表（全平台） */
  @Get()
  @RequirePermission('after-sale:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('afterSaleType') afterSaleType?: string,
    @Query('companyId') companyId?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.afterSaleService.findAll(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
      afterSaleType,
      companyId,
      keyword,
    );
  }

  /** 售后状态统计 */
  @Get('stats')
  @RequirePermission('after-sale:read')
  getStats() {
    return this.afterSaleService.getStats();
  }

  /** 售后详情 */
  @Get(':id')
  @RequirePermission('after-sale:read')
  findById(@Param('id') id: string) {
    return this.afterSaleService.findById(id);
  }

  /** 管理员仲裁 */
  @Post(':id/arbitrate')
  @RequirePermission('after-sale:arbitrate')
  @AuditLog({
    action: 'STATUS_CHANGE',
    module: 'after-sale',
    targetType: 'AfterSale',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  arbitrate(
    @Param('id') id: string,
    @Body() dto: ArbitrateAfterSaleDto,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.afterSaleService.arbitrate(id, dto, adminUserId);
  }
}
