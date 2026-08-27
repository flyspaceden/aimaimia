import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSeller } from '../seller/common/decorators/current-seller.decorator';
import { SellerAudit } from '../seller/common/decorators/seller-audit.decorator';
import { SellerAuthGuard } from '../seller/common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../seller/common/guards/seller-role.guard';
import { SellerAuditInterceptor } from '../seller/common/interceptors/seller-audit.interceptor';
import { AimaiProductVisualAdapterService } from './aimai-product-visual-adapter.service';
import { ConfirmProductVisualQuoteDto, IssueProductVisualQuoteDto } from './product-visual-commerce.dto';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/products')
export class ProductVisualCommerceController {
  constructor(private readonly visual: AimaiProductVisualAdapterService) {}

  @Get(':id/visual-credit-account')
  @SellerRoles('OWNER', 'MANAGER')
  account(@CurrentSeller('companyId') companyId: string) {
    return this.visual.getAccount(companyId);
  }

  @Post(':id/visual-quotes')
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'CREATE_PRODUCT_VISUAL_QUOTE', module: 'product-images', targetType: 'VisualCreditQuote', targetIdResponseKey: 'quote.id' })
  issueQuote(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') productId: string,
    @Body() dto: IssueProductVisualQuoteDto,
  ) {
    return this.visual.issueQuote({ companyId, staffId, productId, ...dto });
  }

  @Post(':id/visual-quotes/:quoteId/confirm')
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'CONFIRM_PRODUCT_VISUAL_QUOTE', module: 'product-images', targetType: 'VisualCreditQuote', targetIdParam: 'params.quoteId' })
  confirmQuote(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') productId: string,
    @Param('quoteId') quoteId: string,
    @Body() dto: ConfirmProductVisualQuoteDto,
  ) {
    return this.visual.confirmQuote({ companyId, staffId, productId, quoteId, quoteHash: dto.quoteHash });
  }
}
