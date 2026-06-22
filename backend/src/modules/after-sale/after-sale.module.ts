import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AfterSaleController } from './after-sale.controller';
import { AfterSaleService } from './after-sale.service';
import { AfterSaleRewardService } from './after-sale-reward.service';
import { AfterSaleTimeoutService } from './after-sale-timeout.service';
import { AfterSaleRefundService } from './after-sale-refund.service';
import { AfterSaleStatusHistoryService } from './after-sale-status-history.service';
import { AfterSaleRefundConsistencyService } from './after-sale-refund-consistency.service';
import { AfterSaleShippingPaymentService } from './after-sale-shipping-payment.service';
import { AfterSaleReturnShippingService } from './after-sale-return-shipping.service';
import { PaymentModule } from '../payment/payment.module';
import { PaymentService } from '../payment/payment.service';
import { WechatPayService } from '../payment/wechat-pay.service';
import { InboxModule } from '../inbox/inbox.module';
import { SellerShippingModule } from '../seller/shipping/seller-shipping.module';
import { ShipmentModule } from '../shipment/shipment.module';
import { ShippingRuleModule } from '../admin/shipping-rule/shipping-rule.module';
import { ShippingRuleService } from '../admin/shipping-rule/shipping-rule.service';
import { RewardDeductionService } from '../bonus/reward-deduction.service';
import { DigitalAssetModule } from '../digital-asset/digital-asset.module';
import { DigitalAssetService } from '../digital-asset/digital-asset.service';
import { ProductModule } from '../product/product.module';
import { GroupBuyRebateDeductionService } from '../group-buy/group-buy-rebate-deduction.service';

@Module({
  imports: [
    forwardRef(() => PaymentModule),
    InboxModule,
    SellerShippingModule,
    ShipmentModule,
    ShippingRuleModule,
    DigitalAssetModule,
    ProductModule,
  ],
  controllers: [AfterSaleController],
  providers: [
    AfterSaleService,
    AfterSaleRewardService,
    AfterSaleTimeoutService,
    AfterSaleRefundService,
    AfterSaleStatusHistoryService,
    AfterSaleRefundConsistencyService,
    AfterSaleShippingPaymentService,
    AfterSaleReturnShippingService,
    RewardDeductionService,
  ],
  exports: [
    AfterSaleService,
    AfterSaleRewardService,
    AfterSaleRefundService,
    AfterSaleStatusHistoryService,
    AfterSaleShippingPaymentService,
    AfterSaleReturnShippingService,
  ],
})
export class AfterSaleModule implements OnModuleInit {
  constructor(
    private moduleRef: ModuleRef,
    private afterSaleService: AfterSaleService,
    private afterSaleRefundService: AfterSaleRefundService,
    private afterSaleShippingPaymentService: AfterSaleShippingPaymentService,
  ) {}

  onModuleInit() {
    const paymentService = this.moduleRef.get(PaymentService, { strict: false });
    if (paymentService?.setAfterSaleRefundService) {
      paymentService.setAfterSaleRefundService(this.afterSaleRefundService);
    }
    if (paymentService?.setAfterSaleShippingPaymentService) {
      paymentService.setAfterSaleShippingPaymentService(this.afterSaleShippingPaymentService);
    }
    const shippingRuleService = this.moduleRef.get(ShippingRuleService, { strict: false });
    if (shippingRuleService) {
      this.afterSaleService.setShippingRuleService(shippingRuleService);
      this.afterSaleShippingPaymentService.setShippingRuleService(shippingRuleService);
    }
    const rewardDeductionService = this.moduleRef.get(RewardDeductionService, { strict: false });
    if (rewardDeductionService) {
      this.afterSaleRefundService.setRewardDeductionService(rewardDeductionService);
    }
    const digitalAssetService = this.moduleRef.get(DigitalAssetService, { strict: false });
    if (digitalAssetService) {
      this.afterSaleRefundService.setDigitalAssetService(digitalAssetService);
    }
    const groupBuyRebateDeductionService = this.moduleRef.get(
      GroupBuyRebateDeductionService,
      { strict: false },
    );
    if (groupBuyRebateDeductionService) {
      this.afterSaleRefundService.setGroupBuyRebateDeductionService(
        groupBuyRebateDeductionService,
      );
    }
    const wechatPayService = this.moduleRef.get(WechatPayService, { strict: false });
    if (wechatPayService) {
      this.afterSaleShippingPaymentService.setWechatPayService(wechatPayService);
    }
  }
}
