import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BonusModule } from '../bonus/bonus.module';
import { ShippingRuleModule } from '../admin/shipping-rule/shipping-rule.module';
import { CouponModule } from '../coupon/coupon.module';
import { PaymentModule } from '../payment/payment.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { CheckoutService } from './checkout.service';
import { CheckoutExpireService } from './checkout-expire.service';
import { OrderAutoConfirmService } from './order-auto-confirm.service';
import { OrderExpireService } from './order-expire.service';
import { BonusCompensationService } from './bonus-compensation.service';
import { ShippingRuleService } from '../admin/shipping-rule/shipping-rule.service';
import { CouponService } from '../coupon/coupon.service';
import { CouponEngineService } from '../coupon/coupon-engine.service';
import { BonusService } from '../bonus/bonus.service';
import { AlipayService } from '../payment/alipay.service';
import { AfterSaleModule } from '../after-sale/after-sale.module';
import { InboxModule } from '../inbox/inbox.module';
import { InboxService } from '../inbox/inbox.service';

@Module({
  imports: [BonusModule, ShippingRuleModule, AfterSaleModule, CouponModule, InboxModule, forwardRef(() => PaymentModule)],
  controllers: [OrderController],
  providers: [
    OrderService,
    CheckoutService,
    CheckoutExpireService,
    OrderAutoConfirmService,
    OrderExpireService,
    BonusCompensationService,
  ],
  exports: [OrderService, CheckoutService],
})
export class OrderModule implements OnModuleInit {
  constructor(
    private moduleRef: ModuleRef,
    private orderService: OrderService,
    private checkoutService: CheckoutService,
    private checkoutExpireService: CheckoutExpireService,
  ) {}

  onModuleInit() {
    // 注入运费规则服务（避免构造函数循环依赖）
    const shippingRuleService = this.moduleRef.get(ShippingRuleService, { strict: false });
    if (shippingRuleService) {
      this.orderService.setShippingRuleService(shippingRuleService);
      this.checkoutService.setShippingRuleService(shippingRuleService);
    } else {
      console.warn('[OrderModule] ShippingRuleService 未注入，运费计算将使用 ShippingTemplate 兜底');
    }

    // 注入红包服务（避免构造函数循环依赖）
    const couponService = this.moduleRef.get(CouponService, { strict: false });
    if (couponService) {
      this.orderService.setCouponService(couponService);
      this.checkoutService.setCouponService(couponService);
      this.checkoutExpireService.setCouponService(couponService);
    } else {
      console.warn('[OrderModule] CouponService 未注入，红包功能不可用');
    }

    // 注入红包引擎服务（用于确认收货后触发 FIRST_ORDER / CUMULATIVE_SPEND）
    const couponEngineService = this.moduleRef.get(CouponEngineService, { strict: false });
    if (couponEngineService) {
      this.orderService.setCouponEngineService(couponEngineService);
    }

    // 注入分润服务（VIP 支付回调激活用）
    const bonusService = this.moduleRef.get(BonusService, { strict: false });
    if (bonusService) {
      this.checkoutService.setBonusService(bonusService);
    } else {
      console.warn('[OrderModule] BonusService 未注入，VIP 支付后激活功能不可用');
    }

    // C13修复：InboxService 改硬依赖，确保通知功能可用
    const inboxService = this.moduleRef.get(InboxService, { strict: false });
    if (!inboxService) {
      throw new Error('[OrderModule] InboxService 未注入，站内消息功能不可用，启动中止');
    }
    this.checkoutService.setInboxService(inboxService);

    // 注入支付宝服务
    const alipayService = this.moduleRef.get(AlipayService, { strict: false });
    if (alipayService) {
      this.checkoutService.setAlipayService(alipayService);
    }
  }
}
