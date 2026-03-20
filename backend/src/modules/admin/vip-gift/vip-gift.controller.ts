import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { VipGiftService } from './vip-gift.service';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import {
  CreateVipGiftOptionDto,
  UpdateVipGiftOptionDto,
  UpdateVipGiftOptionStatusDto,
} from './vip-gift.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/vip/gift-options')
export class VipGiftController {
  constructor(private vipGiftService: VipGiftService) {}

  /** 赠品方案列表 */
  @Get()
  @RequirePermission('vip_gift:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.vipGiftService.findAll(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
    );
  }

  /** 奖励商品 SKU 选择器（必须在 :id 路由之前） */
  @Get('reward-skus')
  @RequirePermission('vip_gift:read')
  getRewardProductSkus(@Query('productId') productId?: string) {
    return this.vipGiftService.getRewardProductSkus(productId);
  }

  /** 查询 SKU 引用关系（必须在 :id 路由之前） */
  @Get('sku-references/:skuId')
  @RequirePermission('vip_gift:read')
  getSkuReferences(@Param('skuId') skuId: string) {
    return this.vipGiftService.getSkuReferences(skuId);
  }

  /** 赠品方案详情 */
  @Get(':id')
  @RequirePermission('vip_gift:read')
  findOne(@Param('id') id: string) {
    return this.vipGiftService.findOne(id);
  }

  /** 创建赠品方案 */
  @Post()
  @RequirePermission('vip_gift:create')
  @AuditLog({
    action: 'CREATE',
    module: 'vip_gift',
    targetType: 'VipGiftOption',
    isReversible: false,
  })
  create(@Body() dto: CreateVipGiftOptionDto) {
    return this.vipGiftService.create(dto);
  }

  /** 更新赠品方案 */
  @Patch(':id')
  @RequirePermission('vip_gift:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'vip_gift',
    targetType: 'VipGiftOption',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  update(@Param('id') id: string, @Body() dto: UpdateVipGiftOptionDto) {
    return this.vipGiftService.update(id, dto);
  }

  /** 更新赠品方案状态（上架/下架） */
  @Patch(':id/status')
  @RequirePermission('vip_gift:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'vip_gift',
    targetType: 'VipGiftOption',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateVipGiftOptionStatusDto) {
    return this.vipGiftService.updateStatus(id, dto);
  }

  /** 删除赠品方案 */
  @Delete(':id')
  @RequirePermission('vip_gift:delete')
  @AuditLog({
    action: 'DELETE',
    module: 'vip_gift',
    targetType: 'VipGiftOption',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  remove(@Param('id') id: string) {
    return this.vipGiftService.delete(id);
  }
}
