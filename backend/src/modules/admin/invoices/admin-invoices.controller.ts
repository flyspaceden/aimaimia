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
import { AdminInvoicesService } from './admin-invoices.service';
import { AdminInvoiceQueryDto, IssueInvoiceDto, FailInvoiceDto } from './dto/admin-invoice.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/invoices')
export class AdminInvoicesController {
  constructor(private invoicesService: AdminInvoicesService) {}

  /** 发票列表 */
  @Get()
  @RequirePermission('invoices:read')
  findAll(
    @Query() query: AdminInvoiceQueryDto,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.invoicesService.findAll(
      query,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  /** 发票状态统计 */
  @Get('stats')
  @RequirePermission('invoices:read')
  getStats() {
    return this.invoicesService.getStats();
  }

  /** 发票详情 */
  @Get(':id')
  @RequirePermission('invoices:read')
  findById(@Param('id') id: string) {
    return this.invoicesService.findById(id);
  }

  /** 开票 */
  @Post(':id/issue')
  @RequirePermission('invoices:issue')
  @AuditLog({
    action: 'STATUS_CHANGE',
    module: 'invoices',
    targetType: 'Invoice',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  issueInvoice(@Param('id') id: string, @Body() dto: IssueInvoiceDto) {
    return this.invoicesService.issueInvoice(id, dto);
  }

  /** 标记开票失败 */
  @Post(':id/fail')
  @RequirePermission('invoices:issue')
  @AuditLog({
    action: 'STATUS_CHANGE',
    module: 'invoices',
    targetType: 'Invoice',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  failInvoice(@Param('id') id: string, @Body() dto: FailInvoiceDto) {
    return this.invoicesService.failInvoice(id, dto);
  }
}
