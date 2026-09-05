import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSeller } from '../seller/common/decorators/current-seller.decorator';
import { SellerAudit } from '../seller/common/decorators/seller-audit.decorator';
import { SellerAuthGuard } from '../seller/common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../seller/common/guards/seller-role.guard';
import { SellerAuditInterceptor } from '../seller/common/interceptors/seller-audit.interceptor';
import { RequestProductImageFactScanDto } from './product-image-fact-scan.dto';
import { ProductImageFactScanService } from './product-image-fact-scan.service';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/media-assets')
export class ProductImageFactScanController {
  constructor(private readonly scans: ProductImageFactScanService) {}

  @Post(':id/fact-scan')
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'REQUEST_PRODUCT_IMAGE_FACT_SCAN', module: 'product-images', targetType: 'ProductImageFactScan', targetIdParam: 'params.id' })
  request(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') sourceAssetId: string,
    @Body() dto: RequestProductImageFactScanDto,
  ) {
    return this.scans.request(companyId, staffId, sourceAssetId, dto);
  }

  @Get('fact-scans/:scanId')
  get(@CurrentSeller('companyId') companyId: string, @Param('scanId') scanId: string) {
    return this.scans.get(companyId, scanId);
  }
}
