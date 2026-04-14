import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SellerProductsService } from './seller-products.service';
import {
  CreateProductDto,
  UpdateProductDto,
  UpdateSkusDto,
  ProductStatusDto,
} from './seller-products.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../common/guards/seller-role.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';
import { SellerAudit } from '../common/decorators/seller-audit.decorator';
import { SellerAuditInterceptor } from '../common/interceptors/seller-audit.interceptor';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/products')
export class SellerProductsController {
  constructor(private productsService: SellerProductsService) {}

  /** 我的商品列表 */
  @Get()
  findAll(
    @CurrentSeller('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('auditStatus') auditStatus?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.productsService.findAll(
      companyId,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
      status,
      auditStatus,
      keyword,
    );
  }

  /** 商品详情 */
  @Get(':id')
  findById(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.productsService.findById(companyId, id);
  }

  /** 创建商品 */
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'CREATE_PRODUCT', module: 'products', targetType: 'Product' })
  @Post()
  create(
    @CurrentSeller('companyId') companyId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.create(companyId, dto);
  }

  /** 编辑商品 */
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'UPDATE_PRODUCT', module: 'products', targetType: 'Product', targetIdParam: 'params.id' })
  @Put(':id')
  update(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(companyId, id, dto);
  }

  /** 上架/下架 */
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'TOGGLE_PRODUCT_STATUS', module: 'products', targetType: 'Product', targetIdParam: 'params.id' })
  @Post(':id/status')
  toggleStatus(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: ProductStatusDto,
  ) {
    return this.productsService.toggleStatus(companyId, id, dto.status);
  }

  /** 管理 SKU */
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'UPDATE_SKUS', module: 'products', targetType: 'Product', targetIdParam: 'params.id' })
  @Put(':id/skus')
  updateSkus(
    @CurrentSeller('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSkusDto,
  ) {
    return this.productsService.updateSkus(companyId, id, dto.skus);
  }
}
