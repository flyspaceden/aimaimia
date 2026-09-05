import { Body, Controller, Get, Param, Post, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSeller } from '../seller/common/decorators/current-seller.decorator';
import { SellerAudit } from '../seller/common/decorators/seller-audit.decorator';
import { SellerAuthGuard } from '../seller/common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../seller/common/guards/seller-role.guard';
import { SellerAuditInterceptor } from '../seller/common/interceptors/seller-audit.interceptor';
import { AdoptProductImageOptimizationDto, RequestProductImageOptimizationDto } from './product-image-optimization.dto';
import { ProductImageOptimizationService } from './product-image-optimization.service';
import { ProductImageCandidateDownloadService } from './product-image-candidate-download.service';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/product-image-optimizations')
export class ProductImageOptimizationController {
  constructor(
    private readonly optimizations: ProductImageOptimizationService,
    private readonly downloads: ProductImageCandidateDownloadService,
  ) {}

  @Get(':id/download')
  @SellerRoles('OWNER', 'MANAGER')
  async download(@CurrentSeller('companyId') companyId: string, @Param('id') id: string, @Res() res: Response) {
    const file = await this.downloads.download(companyId, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', file.buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(file.buffer);
  }

  @Post()
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'CREATE_PRODUCT_IMAGE_OPTIMIZATION', module: 'product-images', targetType: 'ProductImageOptimization' })
  request(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Body() dto: RequestProductImageOptimizationDto,
  ) {
    return dto.intent === 'FREE_TUNE'
      ? this.optimizations.requestFreeTune(companyId, staffId, dto)
      : this.optimizations.requestWhiteBackground(companyId, staffId, dto);
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
