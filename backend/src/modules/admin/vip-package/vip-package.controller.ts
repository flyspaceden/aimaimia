import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { VipPackageService } from './vip-package.service';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { CreateVipPackageDto, UpdateVipPackageDto } from './vip-package.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/vip/packages')
export class VipPackageController {
  constructor(private vipPackageService: VipPackageService) {}

  /** 查询所有 VIP 档位 */
  @Get()
  @RequirePermission('config:read')
  findAll() {
    return this.vipPackageService.findAll();
  }

  /** 创建 VIP 档位 */
  @Post()
  @RequirePermission('config:update')
  @AuditLog({
    action: 'CREATE',
    module: 'vip_package',
    targetType: 'VipPackage',
    isReversible: false,
  })
  create(@Body() dto: CreateVipPackageDto) {
    return this.vipPackageService.create(dto);
  }

  /** 更新 VIP 档位 */
  @Patch(':id')
  @RequirePermission('config:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'vip_package',
    targetType: 'VipPackage',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  update(@Param('id') id: string, @Body() dto: UpdateVipPackageDto) {
    return this.vipPackageService.update(id, dto);
  }

  /** 删除 VIP 档位 */
  @Delete(':id')
  @RequirePermission('config:update')
  @AuditLog({
    action: 'DELETE',
    module: 'vip_package',
    targetType: 'VipPackage',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  remove(@Param('id') id: string) {
    return this.vipPackageService.remove(id);
  }
}
