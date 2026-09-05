import { Body, Controller, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSeller } from '../seller/common/decorators/current-seller.decorator';
import { SellerAudit } from '../seller/common/decorators/seller-audit.decorator';
import { SellerAuthGuard } from '../seller/common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../seller/common/guards/seller-role.guard';
import { SellerAuditInterceptor } from '../seller/common/interceptors/seller-audit.interceptor';
import { RequestProductMediaRevisionDto } from './product-media-revision.dto';
import { ProductMediaRevisionsService } from './product-media-revisions.service';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/products')
export class ProductMediaRevisionsController {
  constructor(private readonly revisions: ProductMediaRevisionsService) {}

  @Post(':id/media-revisions')
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'REQUEST_PRODUCT_MEDIA_REVISION', module: 'product-images', targetType: 'Product', targetIdParam: 'params.id' })
  request(
    @CurrentSeller('companyId') companyId: string,
    // Seller JWT exposes CompanyStaff.id as `sub`; unlike buyer contexts it
    // does not carry a `staffId` field.
    @CurrentSeller('sub') staffId: string,
    @Param('id') productId: string,
    @Body() dto: RequestProductMediaRevisionDto,
  ) {
    return this.revisions.request(companyId, staffId, productId, dto);
  }
}
