import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AdminProductsService } from './admin-products.service';
import { AdminUpdateProductDto, ToggleProductStatusDto, AuditProductDto } from './dto/update-product.dto';
import { UpdateProductSkusDto } from './dto/update-sku.dto';
import { SemanticFillService } from '../../product/semantic-fill.service';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    private productsService: AdminProductsService,
    private semanticFillService: SemanticFillService,
  ) {}

  @Get()
  @RequirePermission('products:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('auditStatus') auditStatus?: string,
    @Query('keyword') keyword?: string,
    @Query('companyId') companyId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.productsService.findAll(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
      auditStatus,
      keyword,
      companyId,
      startDate,
      endDate,
    );
  }

  @Get('stats')
  @RequirePermission('products:read')
  getStats() {
    return this.productsService.getStats();
  }

  @Get(':id')
  @RequirePermission('products:read')
  findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Put(':id')
  @RequirePermission('products:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'products',
    targetType: 'Product',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  update(@Param('id') id: string, @Body() dto: AdminUpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Post(':id/toggle-status')
  @RequirePermission('products:update')
  @AuditLog({
    action: 'STATUS_CHANGE',
    module: 'products',
    targetType: 'Product',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  toggleStatus(
    @Param('id') id: string,
    @Body() dto: ToggleProductStatusDto,
  ) {
    return this.productsService.toggleStatus(id, dto.status);
  }

  @Delete(':id')
  @RequirePermission('products:delete')
  @AuditLog({
    action: 'DELETE',
    module: 'products',
    targetType: 'Product',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Post(':id/audit')
  @RequirePermission('products:audit')
  @AuditLog({
    action: 'APPROVE',
    module: 'products',
    targetType: 'Product',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  audit(
    @Param('id') id: string,
    @Body() dto: AuditProductDto,
  ) {
    return this.productsService.audit(id, dto.auditStatus, dto.auditNote);
  }

  /** C21: 批量编辑商品 SKU（UPSERT） */
  @Put(':id/skus')
  @RequirePermission('products:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'products',
    targetType: 'Product',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  updateSkus(@Param('id') id: string, @Body() dto: UpdateProductSkusDto) {
    return this.productsService.updateSkus(id, dto);
  }

  /** 清除 AI 语义字段来源标记，并触发 AI 重新填充 */
  @Post(':id/refill-semantic')
  @RequirePermission('products:update')
  async refillSemantic(@Param('id') id: string) {
    // 清除所有语义字段的来源标记（将 ai/seller/ops 标记置空），让 fillProduct 重新覆盖
    await this.productsService.clearSemanticMeta(id);
    // 异步触发 AI 填充，不阻塞响应
    this.semanticFillService.fillProduct(id).catch(() => undefined);
    return { message: '已触发 AI 重新生成语义标签' };
  }
}
