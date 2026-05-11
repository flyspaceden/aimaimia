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
import { InboxModule } from '../inbox/inbox.module';
import { SellerShippingModule } from '../seller/shipping/seller-shipping.module';
import { ShipmentModule } from '../shipment/shipment.module';

@Module({
  imports: [forwardRef(() => PaymentModule), InboxModule, SellerShippingModule, ShipmentModule],
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
