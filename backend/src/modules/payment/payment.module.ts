import { Module, forwardRef } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';
import { OrderModule } from '../order/order.module';
import { CouponModule } from '../coupon/coupon.module';

@Module({
  imports: [forwardRef(() => OrderModule), CouponModule],
  controllers: [PaymentController],
  providers: [PaymentService, WebhookIpGuard],
  exports: [PaymentService],
})
export class PaymentModule {}
