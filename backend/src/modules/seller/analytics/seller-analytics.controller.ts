import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SellerAnalyticsService } from './seller-analytics.service';
import { Public } from '../../../common/decorators/public.decorator';
import { SellerAuthGuard } from '../common/guards/seller-auth.guard';
import { SellerRoleGuard, SellerRoles } from '../common/guards/seller-role.guard';
import { CurrentSeller } from '../common/decorators/current-seller.decorator';

@Public()
@UseGuards(SellerAuthGuard, SellerRoleGuard)
@SellerRoles('OWNER', 'MANAGER')
@Controller('seller/analytics')
export class SellerAnalyticsController {
  constructor(private analyticsService: SellerAnalyticsService) {}

  /** 概览数据 */
  @Get('overview')
  getOverview(@CurrentSeller('companyId') companyId: string) {
    return this.analyticsService.getOverview(companyId);
  }

  /** 销售趋势 */
  @Get('sales')
  getSalesTrend(
    @CurrentSeller('companyId') companyId: string,
    @Query('days') days?: string,
  ) {
    return this.analyticsService.getSalesTrend(companyId, days ? parseInt(days) : 30);
  }

  /** 商品排行 */
  @Get('products')
  getProductRanking(
    @CurrentSeller('companyId') companyId: string,
    @Query('limit') limit?: string,
  ) {
    return this.analyticsService.getProductRanking(companyId, limit ? parseInt(limit) : 10);
  }

  /** 订单统计 */
  @Get('orders')
  getOrderStats(@CurrentSeller('companyId') companyId: string) {
    return this.analyticsService.getOrderStats(companyId);
  }
}
