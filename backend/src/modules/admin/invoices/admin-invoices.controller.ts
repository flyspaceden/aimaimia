import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminInvoicesService } from './admin-invoices.service';
import {
  AdminInvoiceQueryDto,
  FailInvoiceDto,
  IssueInvoiceDto,
  UpdateInvoiceSettingsDto,
} from './dto/admin-invoice.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { SUPER_ADMIN_ROLE } from '../common/constants';

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
    @CurrentAdmin() admin?: any,
  ) {
    return this.invoicesService.findAll(
      query,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      { includeSensitive: this.canViewSensitiveInvoice(admin) },
    );
  }

  /** 发票状态统计 */
  @Get('stats')
  @RequirePermission('invoices:read')
  getStats() {
    return this.invoicesService.getStats();
  }

  /** 发票设置 */
  @Get('settings')
  @RequirePermission('invoices:issue')
  getSettings() {
    return this.invoicesService.getInvoiceSettings();
  }

  /** 更新发票设置 */
  @Put('settings')
  @RequirePermission('invoices:issue')
  @AuditLog({
    action: 'CONFIG_CHANGE',
    module: 'invoices',
    targetType: 'RuleConfig',
    isReversible: true,
  })
  updateSettings(@Body() dto: UpdateInvoiceSettingsDto) {
    return this.invoicesService.updateInvoiceSettings(dto);
  }

  /** 发票详情 */
  @Get(':id')
  @RequirePermission('invoices:read')
  findById(@Param('id') id: string, @CurrentAdmin() admin?: any) {
    return this.invoicesService.findById(id, {
      includeSensitive: this.canViewSensitiveInvoice(admin),
    });
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
  issueInvoice(
    @Param('id') id: string,
    @Body() dto: IssueInvoiceDto,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.invoicesService.issueInvoice(id, dto, adminId);
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
  failInvoice(
    @Param('id') id: string,
    @Body() dto: FailInvoiceDto,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.invoicesService.failInvoice(id, dto, adminId);
  }

  /** 重置卡住的开票 Provider 任务 */
  @Post(':id/reset-provider-reservation')
  @RequirePermission('invoices:issue')
  @AuditLog({
    action: 'UPDATE',
    module: 'invoices',
    targetType: 'Invoice',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  resetProviderReservation(
    @Param('id') id: string,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.invoicesService.resetProviderReservation(id, adminId);
  }

  private canViewSensitiveInvoice(admin?: any): boolean {
    return Boolean(
      admin?.permissions?.includes('invoices:issue') ||
      admin?.roles?.includes(SUPER_ADMIN_ROLE),
    );
  }
}
