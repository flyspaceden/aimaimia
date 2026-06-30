import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { GroupBuyCheckoutService } from './group-buy-checkout.service';
import { GroupBuyController } from './group-buy.controller';
import { GroupBuyLifecycleService } from './group-buy-lifecycle.service';
import { GroupBuyRebateDeductionService } from './group-buy-rebate-deduction.service';
import { GroupBuyRebateService } from './group-buy-rebate.service';
import { GroupBuyService } from './group-buy.service';
import { ShippingRuleModule } from '../admin/shipping-rule/shipping-rule.module';
import { ShippingRuleService } from '../admin/shipping-rule/shipping-rule.service';
import { BonusModule } from '../bonus/bonus.module';
import { AlipayService } from '../payment/alipay.service';
import { WechatPayService } from '../payment/wechat-pay.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [BonusModule, ShippingRuleModule, NotificationModule],
  controllers: [GroupBuyController],
  providers: [
    GroupBuyService,
    GroupBuyCheckoutService,
    GroupBuyLifecycleService,
    GroupBuyRebateDeductionService,
    GroupBuyRebateService,
  ],
  exports: [
    GroupBuyCheckoutService,
    GroupBuyLifecycleService,
    GroupBuyRebateDeductionService,
    GroupBuyRebateService,
  ],
})
export class GroupBuyModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly checkoutService: GroupBuyCheckoutService,
  ) {}

  onModuleInit() {
    const alipayService = this.moduleRef.get(AlipayService, { strict: false });
    if (alipayService) {
      this.checkoutService.setAlipayService(alipayService);
    }

    const wechatPayService = this.moduleRef.get(WechatPayService, { strict: false });
    if (wechatPayService) {
      this.checkoutService.setWechatPayService(wechatPayService);
    }

    const shippingRuleService = this.moduleRef.get(ShippingRuleService, { strict: false });
    if (shippingRuleService) {
      this.checkoutService.setShippingRuleService(shippingRuleService);
    }
  }
}
