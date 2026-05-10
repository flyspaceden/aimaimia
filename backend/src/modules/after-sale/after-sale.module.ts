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
import { PaymentModule } from '../payment/payment.module';
import { PaymentService } from '../payment/payment.service';
import { InboxModule } from '../inbox/inbox.module';

@Module({
  imports: [forwardRef(() => PaymentModule), InboxModule],
  controllers: [AfterSaleController],
  providers: [
    AfterSaleService,
    AfterSaleRewardService,
    AfterSaleTimeoutService,
    AfterSaleRefundService,
    AfterSaleStatusHistoryService,
    AfterSaleRefundConsistencyService,
    AfterSaleShippingPaymentService,
  ],
  exports: [
    AfterSaleService,
    AfterSaleRewardService,
    AfterSaleRefundService,
    AfterSaleStatusHistoryService,
    AfterSaleShippingPaymentService,
  ],
})
export class AfterSaleModule implements OnModuleInit {
  constructor(
    private moduleRef: ModuleRef,
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
  }
}
