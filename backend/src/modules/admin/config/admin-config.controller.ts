import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminConfigService } from './admin-config.service';
import { UpdateConfigDto, BatchUpdateConfigDto } from './dto/admin-config.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/config')
export class AdminConfigController {
  constructor(private configService: AdminConfigService) {}

  @Get()
  @RequirePermission('config:read')
  findAll() {
    return this.configService.findAll();
  }

  @Get('versions')
  @RequirePermission('config:read')
  findVersions(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.configService.findVersions(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get('versions/:id')
  @RequirePermission('config:read')
  findVersionById(@Param('id') id: string) {
    return this.configService.findVersionById(id);
  }

  @Post('versions/:id/rollback')
  @RequirePermission('config:update')
  @AuditLog({
    action: 'ROLLBACK',
    module: 'config',
    isReversible: true,
  })
  rollbackToVersion(
    @Param('id') id: string,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.configService.rollbackToVersion(id, adminUserId);
  }

  @Put('batch')
  @RequirePermission('config:update')
  @AuditLog({
    action: 'CONFIG_CHANGE',
    module: 'config',
    isReversible: true,
  })
  batchUpdate(
    @Body() dto: BatchUpdateConfigDto,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.configService.batchUpdate(dto, adminUserId);
  }

  @Get(':key')
  @RequirePermission('config:read')
  findByKey(@Param('key') key: string) {
    return this.configService.findByKey(key);
  }

  @Put(':key')
  @RequirePermission('config:update')
  @AuditLog({
    action: 'CONFIG_CHANGE',
    module: 'config',
    targetType: 'RuleConfig',
    targetIdParam: 'params.key',
    isReversible: true,
  })
  update(
    @Param('key') key: string,
    @Body() dto: UpdateConfigDto,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.configService.update(key, dto, adminUserId);
  }
}
