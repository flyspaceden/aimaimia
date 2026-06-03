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
import { RewardProductService } from './reward-product.service';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequirePermission } from '../common/decorators/require-permission';
import { AuditLog } from '../common/decorators/audit-action';
import { AuditLogInterceptor } from '../common/interceptors/audit-log.interceptor';
import {
  CreateRewardProductDto,
  UpdateRewardProductDto,
  UpdateRewardProductSkuDto,
  CreateRewardProductSkuForUpdateDto,
} from './reward-product.dto';

@Public()
@UseGuards(AdminAuthGuard, PermissionGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/reward-products')
export class RewardProductController {
  constructor(private rewardProductService: RewardProductService) {}

  /** 奖励商品列表 */
  @Get()
  @RequirePermission('reward_products:read')
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ) {
    return this.rewardProductService.findAll(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      keyword,
      status,
    );
  }

  /** 奖励商品详情 */
  @Get(':id')
  @RequirePermission('reward_products:read')
  findOne(@Param('id') id: string) {
    return this.rewardProductService.findOne(id);
  }

  /** 创建奖励商品 */
  @Post()
  @RequirePermission('reward_products:create')
  @AuditLog({
    action: 'CREATE',
    module: 'reward_products',
    targetType: 'Product',
    isReversible: false,
  })
  create(@Body() dto: CreateRewardProductDto) {
    return this.rewardProductService.create(dto);
  }

  /** 更新奖励商品 */
  @Put(':id')
  @RequirePermission('reward_products:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'reward_products',
    targetType: 'Product',
    targetIdParam: 'params.id',
    isReversible: true,
  })
  update(@Param('id') id: string, @Body() dto: UpdateRewardProductDto) {
    return this.rewardProductService.update(id, dto);
  }

  /** 删除奖励商品（硬删除） */
  @Delete(':id')
  @RequirePermission('reward_products:delete')
  @AuditLog({
    action: 'DELETE',
    module: 'reward_products',
    targetType: 'Product',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  remove(@Param('id') id: string) {
    return this.rewardProductService.remove(id);
  }

  /** 新增 SKU */
  @Post(':id/skus')
  @RequirePermission('reward_products:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'reward_products',
    targetType: 'ProductSKU',
    targetIdParam: 'params.id',
    isReversible: false,
  })
  addSku(
    @Param('id') id: string,
    @Body() dto: CreateRewardProductSkuForUpdateDto,
  ) {
    return this.rewardProductService.addSku(id, dto);
  }

  /** 更新 SKU */
  @Put(':id/skus/:skuId')
  @RequirePermission('reward_products:update')
  @AuditLog({
    action: 'UPDATE',
    module: 'reward_products',
    targetType: 'ProductSKU',
    targetIdParam: 'params.skuId',
    isReversible: true,
  })
  updateSku(
    @Param('id') id: string,
    @Param('skuId') skuId: string,
    @Body() dto: UpdateRewardProductSkuDto,
  ) {
    return this.rewardProductService.updateSku(id, skuId, dto);
  }

  /** 删除 SKU */
  @Delete(':id/skus/:skuId')
  @RequirePermission('reward_products:update')
  @AuditLog({
    action: 'DELETE',
    module: 'reward_products',
    targetType: 'ProductSKU',
    targetIdParam: 'params.skuId',
    isReversible: false,
  })
  deleteSku(
    @Param('id') id: string,
    @Param('skuId') skuId: string,
  ) {
    return this.rewardProductService.deleteSku(id, skuId);
  }
}
