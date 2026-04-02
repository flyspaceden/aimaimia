import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminTraceService } from './admin-trace.service';
import { CreateTraceBatchDto, UpdateTraceBatchDto } from './dto/admin-trace.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/trace')
export class AdminTraceController {
  constructor(private traceService: AdminTraceService) {}

  @Get()
  @RequirePermission('trace:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.traceService.findAll(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      companyId,
    );
  }

  @Get(':id')
  @RequirePermission('trace:read')
  findById(@Param('id') id: string) {
    return this.traceService.findById(id);
  }

  @Post()
  @RequirePermission('trace:create')
  @AuditLog({
    action: 'CREATE',
    module: 'trace',
    targetType: 'TraceBatch',
    isReversible: true,
  })
  create(@Body() dto: CreateTraceBatchDto) {
    return this.traceService.create(dto);
  }

  @Put(':id')
  @RequirePermission('trace:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'trace',
    targetType: 'TraceBatch',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  update(@Param('id') id: string, @Body() dto: UpdateTraceBatchDto) {
    return this.traceService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('trace:delete')
  @AuditLog({
    action: 'DELETE',
    module: 'trace',
    targetType: 'TraceBatch',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  remove(@Param('id') id: string) {
    return this.traceService.remove(id);
  }
}
