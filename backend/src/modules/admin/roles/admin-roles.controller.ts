import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminRolesService } from './admin-roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/roles')
export class AdminRolesController {
  constructor(private rolesService: AdminRolesService) {}

  @Get()
  @RequirePermission('admin_roles:read')
  findAll() {
    return this.rolesService.findAll();
  }

  @Get('permissions')
  @RequirePermission('admin_roles:read')
  findAllPermissions() {
    return this.rolesService.findAllPermissions();
  }

  @Get(':id')
  @RequirePermission('admin_roles:read')
  findById(@Param('id') id: string) {
    return this.rolesService.findById(id);
  }

  @Post()
  @RequirePermission('admin_roles:create')
  @AuditLog({
    action: 'CREATE',
    module: 'admin_roles',
    targetType: 'AdminRole',
    isReversible: true,
  })
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Put(':id')
  @RequirePermission('admin_roles:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'admin_roles',
    targetType: 'AdminRole',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('admin_roles:delete')
  @AuditLog({
    action: 'DELETE',
    module: 'admin_roles',
    targetType: 'AdminRole',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  remove(@Param('id') id: string) {
    return this.rolesService.remove(id);
  }
}
