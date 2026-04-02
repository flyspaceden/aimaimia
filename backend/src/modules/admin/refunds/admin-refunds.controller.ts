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
import { AdminRefundsService } from './admin-refunds.service';
import { AdminRefundQueryDto, ArbitrateRefundDto } from './dto/admin-refund.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/refunds')
export class AdminRefundsController {
  constructor(private refundsService: AdminRefundsService) {}

  @Get()
  @RequirePermission('orders:read')
  findAll(
    @Query() query: AdminRefundQueryDto,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.refundsService.findAll(
      query,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get(':id')
  @RequirePermission('orders:read')
  findById(@Param('id') id: string) {
    return this.refundsService.findById(id);
  }

  @Post(':id/arbitrate')
  @RequirePermission('orders:refund')
  @AuditLog({
    action: 'REFUND',
    module: 'refunds',
    targetType: 'Refund',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  arbitrate(@Param('id') id: string, @Body() dto: ArbitrateRefundDto) {
    return this.refundsService.arbitrate(id, dto);
  }
}
