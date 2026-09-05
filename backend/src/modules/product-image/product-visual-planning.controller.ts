import { Body, Controller, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSeller } from '../seller/common/decorators/current-seller.decorator';
import { SellerAudit } from '../seller/common/decorators/seller-audit.decorator';
import { SellerAuthGuard } from '../seller/common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../seller/common/guards/seller-role.guard';
import { SellerAuditInterceptor } from '../seller/common/interceptors/seller-audit.interceptor';
import { CreateProductVisualPlanDto } from './product-visual-planning.dto';
import { ProductVisualPlanningService } from './product-visual-planning.service';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@UseInterceptors(SellerAuditInterceptor)
@Controller('seller/products')
export class ProductVisualPlanningController {
  constructor(private readonly plans: ProductVisualPlanningService) {}

  @Post(':id/visual-enhancements/plan')
  @SellerRoles('OWNER', 'MANAGER')
  @SellerAudit({ action: 'CREATE_PRODUCT_VISUAL_PLAN', module: 'product-images', targetType: 'ProductVisualPlan', targetIdResponseKey: 'id' })
  create(
    @CurrentSeller('companyId') companyId: string,
    @CurrentSeller('sub') staffId: string,
    @Param('id') productId: string,
    @Body() dto: CreateProductVisualPlanDto,
  ) {
    return this.plans.createPlan(companyId, staffId, productId, dto);
  }
}
