import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import { AdminCategoriesService } from './admin-categories.service';
import { CreateCategoryDto, UpdateCategoryDto, BatchSortDto } from './admin-categories.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categoriesService: AdminCategoriesService) {}

  /** 获取完整分类树 */
  @Get()
  @RequirePermission('categories:read')
  findAll() {
    return this.categoriesService.findAll();
  }

  /** 创建分类 */
  @Post()
  @RequirePermission('categories:manage')
  @AuditLog({
    action: 'CREATE',
    module: 'categories',
    targetType: 'Category',
    isReversible: true,
  })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  /** 批量排序（静态路由必须在参数路由 :id 之前） */
  @Put('batch/sort')
  @RequirePermission('categories:manage')
  @AuditLog({
    action: 'UPDATE',
    module: 'categories',
    targetType: 'Category',
    isReversible: true,
  })
  batchSort(@Body() dto: BatchSortDto) {
    return this.categoriesService.batchSort(dto);
  }

  /** 编辑分类 */
  @Put(':id')
  @RequirePermission('categories:manage')
  @AuditLog({
    action: 'UPDATE',
    module: 'categories',
    targetType: 'Category',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  /** 删除分类 */
  @Delete(':id')
  @RequirePermission('categories:manage')
  @AuditLog({
    action: 'DELETE',
    module: 'categories',
    targetType: 'Category',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }

  /** 启用/停用 */
  @Post(':id/toggle-active')
  @RequirePermission('categories:manage')
  @AuditLog({
    action: 'STATUS_CHANGE',
    module: 'categories',
    targetType: 'Category',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  toggleActive(@Param('id') id: string) {
    return this.categoriesService.toggleActive(id);
  }
}
