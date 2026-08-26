import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSeller } from '../seller/common/decorators/current-seller.decorator';
import { SellerAudit } from '../seller/common/decorators/seller-audit.decorator';
import { SellerAuthGuard } from '../seller/common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../seller/common/guards/seller-role.guard';
import { SellerAuditInterceptor } from '../seller/common/interceptors/seller-audit.interceptor';
import { AdoptProductImageOptimizationDto, RequestProductImageOptimizationDto } from './product-image-optimization.dto';
import { ProductImageOptimizationService } from './product-image-optimization.service';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/product-image-optimizations')
export class ProductImageOptimizationController {
  constructor(private readonly optimizations: ProductImageOptimizationService) {}

  @Post()
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'CREATE_PRODUCT_IMAGE_OPTIMIZATION', module: 'product-images', targetType: 'ProductImageOptimization' })
  request(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Body() dto: RequestProductImageOptimizationDto,
  ) {
    return this.optimizations.requestWhiteBackground(companyId, staffId, dto);
  }

  @Get(':id')
  get(@CurrentSeller('companyId') companyId: string, @Param('id') id: string) {
    return this.optimizations.getForSeller(companyId, id);
  }

  @Post(':id/adopt')
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'ADOPT_PRODUCT_IMAGE_OPTIMIZATION', module: 'product-images', targetType: 'ProductImageOptimization', targetIdParam: 'params.id' })
  adopt(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') id: string,
    @Body() dto: AdoptProductImageOptimizationDto,
  ) {
    return this.optimizations.adopt(companyId, staffId, id, dto);
  }

  @Post(':id/cancel')
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'CANCEL_PRODUCT_IMAGE_OPTIMIZATION', module: 'product-images', targetType: 'ProductImageOptimization', targetIdParam: 'params.id' })
  cancel(@CurrentSeller('companyId') companyId: string, @Param('id') id: string) {
    return this.optimizations.cancel(companyId, id);
  }
}
