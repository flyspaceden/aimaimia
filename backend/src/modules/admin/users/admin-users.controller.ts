import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminUsersService } from './admin-users.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto, ResetPasswordDto } from './dto/update-admin-user.dto';
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
@Controller('admin/users')
export class AdminUsersController {
  constructor(private usersService: AdminUsersService) {}

  @Get()
  @RequirePermission('admin_users:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.usersService.findAll(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get(':id')
  @RequirePermission('admin_users:read')
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @RequirePermission('admin_users:create')
  @AuditLog({
    action: 'CREATE',
    module: 'admin_users',
    targetType: 'AdminUser',
    isReversible: true,
  })
  create(
    @Body() dto: CreateAdminUserDto,
    @CurrentAdmin('sub') adminUserId: string,
  ) {
    return this.usersService.create(dto, adminUserId);
  }

  @Put(':id')
  @RequirePermission('admin_users:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'admin_users',
    targetType: 'AdminUser',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
    @CurrentAdmin('sub') operatorId: string,
  ) {
    return this.usersService.update(id, dto, operatorId);
  }

  @Post(':id/reset-password')
  @Throttle({ default: { ttl: 3600000, limit: 5 } }) // L04修复：每 IP 每小时最多 5 次密码重置
  @RequirePermission('admin_users:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'admin_users',
    targetType: 'AdminUser',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentAdmin('sub') operatorId: string,
  ) {
    return this.usersService.resetPassword(id, dto, operatorId);
  }

  @Delete(':id')
  @RequirePermission('admin_users:delete')
  @AuditLog({
    action: 'DELETE',
    module: 'admin_users',
    targetType: 'AdminUser',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  remove(
    @Param('id') id: string,
    @CurrentAdmin('sub') operatorId: string,
  ) {
    return this.usersService.remove(id, operatorId);
  }
}
