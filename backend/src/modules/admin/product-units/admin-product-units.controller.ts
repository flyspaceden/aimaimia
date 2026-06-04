import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { AdminProductUnitsService } from './admin-product-units.service';
import { CreateProductUnitDto, UpdateProductUnitDto } from './admin-product-units.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/product-units')
export class AdminProductUnitsController {
  constructor(private readonly service: AdminProductUnitsService) {}

  /** 全部单位（含停用） */
  @Get()
  @RequirePermission('categories:read')
  findAll() {
    return this.service.findAll();
  }

  /** 新建单位 */
  @Post()
  @RequirePermission('categories:manage')
  @AuditLog({ action: 'CREATE', module: 'product-units', targetType: 'ProductUnit', isReversible: true })
  create(@Body() dto: CreateProductUnitDto) {
    return this.service.create(dto);
  }

  /** 编辑单位 */
  @Patch(':id')
  @RequirePermission('categories:manage')
  @AuditLog({ action: 'UPDATE', module: 'product-units', targetType: 'ProductUnit', targetIdParam: 'params.id', isReversible: true })
  update(@Param('id') id: string, @Body() dto: UpdateProductUnitDto) {
    return this.service.update(id, dto);
  }

  /** 删除单位（硬删除，已有商品 unit 字符串不受影响） */
  @Delete(':id')
  @RequirePermission('categories:manage')
  @AuditLog({ action: 'DELETE', module: 'product-units', targetType: 'ProductUnit', targetIdParam: 'params.id', isReversible: false })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
