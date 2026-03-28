import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { TagScope } from '@prisma/client';
import { AdminTagsService } from './admin-tags.service';
import { CreateTagCategoryDto, UpdateTagCategoryDto, CreateTagDto, UpdateTagDto } from './admin-tags.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/tag-categories')
export class AdminTagCategoriesController {
  constructor(private tagsService: AdminTagsService) {}

  @Get()
  @RequirePermission('tags:read')
  listCategories(@Query('scope') scope?: TagScope) {
    return this.tagsService.listCategories(scope);
  }

  @Post()
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'CREATE', module: 'tags', targetType: 'TagCategory', isReversible: true })
  createCategory(@Body() dto: CreateTagCategoryDto) {
    return this.tagsService.createCategory(dto);
  }

  @Patch(':id')
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'UPDATE', module: 'tags', targetType: 'TagCategory', targetIdParam: 'params.id', isReversible: true })
  updateCategory(@Param('id') id: string, @Body() dto: UpdateTagCategoryDto) {
    return this.tagsService.updateCategory(id, dto);
  }

  @Delete(':id')
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'DELETE', module: 'tags', targetType: 'TagCategory', targetIdParam: 'params.id', isReversible: false })
  deleteCategory(@Param('id') id: string) {
    return this.tagsService.deleteCategory(id);
  }
}

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/tags')
export class AdminTagsController {
  constructor(private tagsService: AdminTagsService) {}

  @Get()
  @RequirePermission('tags:read')
  listTags(@Query('categoryId') categoryId?: string, @Query('scope') scope?: TagScope) {
    return this.tagsService.listTags(categoryId, scope);
  }

  @Post()
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'CREATE', module: 'tags', targetType: 'Tag', isReversible: true })
  createTag(@Body() dto: CreateTagDto) {
    return this.tagsService.createTag(dto);
  }

  @Patch(':id')
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'UPDATE', module: 'tags', targetType: 'Tag', targetIdParam: 'params.id', isReversible: true })
  updateTag(@Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.tagsService.updateTag(id, dto);
  }

  @Delete(':id')
  @RequirePermission('tags:manage')
  @AuditLog({ action: 'DELETE', module: 'tags', targetType: 'Tag', targetIdParam: 'params.id', isReversible: false })
  deleteTag(@Param('id') id: string) {
    return this.tagsService.deleteTag(id);
  }
}
