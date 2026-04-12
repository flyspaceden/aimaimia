import { Module, forwardRef } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { AlipayService } from './alipay.service';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';
import { OrderModule } from '../order/order.module';
import { CouponModule } from '../coupon/coupon.module';
import { InboxModule } from '../inbox/inbox.module';

@Module({
  imports: [forwardRef(() => OrderModule), CouponModule, InboxModule],
  controllers: [PaymentController],
  providers: [PaymentService, AlipayService, WebhookIpGuard],
  exports: [PaymentService, AlipayService],
})
export class PaymentModule {}
