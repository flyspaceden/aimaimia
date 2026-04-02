import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { CouponService } from './coupon.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CheckoutEligibleDto } from './dto/checkout-eligible.dto';
import { TriggerShareDto } from './dto/trigger-share.dto';
import { TriggerReviewDto } from './dto/trigger-review.dto';

/**
 * 买家端红包控制器
 *
 * 使用全局 JwtAuthGuard（默认守卫），所有端点需要买家登录。
 * 注意：这是平台红包（Coupon）系统，与分润奖励（Reward）系统完全独立。
 */
@Controller('coupons')
export class CouponController {
  constructor(private couponService: CouponService) {}

  // ========== 红包活动 ==========

  /** 查询当前可领取的红包活动列表 */
  @Get('available')
  getAvailableCampaigns(@CurrentUser('sub') userId: string) {
    return this.couponService.getAvailableCampaigns(userId);
  }

  /** 查询我的红包列表（支持状态筛选） */
  @Get('my')
  getMyCoupons(
    @CurrentUser('sub') userId: string,
    @Query('status') status?: string,
  ) {
    return this.couponService.getMyCoupons(userId, status);
  }

  /** 领取红包 */
  @Post('claim/:campaignId')
  claimCoupon(
    @CurrentUser('sub') userId: string,
    @Param('campaignId') campaignId: string,
  ) {
    return this.couponService.claimCoupon(userId, campaignId);
  }

  /** 结算时查询可用红包（传入订单信息，返回符合条件的红包及预估折扣） */
  @Post('checkout-eligible')
  getCheckoutEligible(
    @CurrentUser('sub') userId: string,
    @Body() dto: CheckoutEligibleDto,
  ) {
    return this.couponService.getCheckoutEligible(userId, {
      orderAmount: dto.orderAmount,
      categoryIds: dto.categoryIds,
      companyIds: dto.companyIds,
    });
  }

  /** 上报分享事件（触发 SHARE 类型 AUTO 红包） */
  @Post('events/share')
  reportShareEvent(
    @CurrentUser('sub') userId: string,
    @Body() dto: TriggerShareDto,
  ) {
    return this.couponService.triggerShareEvent(userId, dto);
  }

  /** 上报评价事件（触发 REVIEW 类型 AUTO 红包） */
  @Post('events/review')
  reportReviewEvent(
    @CurrentUser('sub') userId: string,
    @Body() dto: TriggerReviewDto,
  ) {
    return this.couponService.triggerReviewEvent(userId, dto);
  }
}
