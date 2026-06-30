import { Module, forwardRef } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { AlipayService } from './alipay.service';
import { WechatPayService } from './wechat-pay.service';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';
import { OrderModule } from '../order/order.module';
import { CouponModule } from '../coupon/coupon.module';
import { NotificationModule } from '../notification/notification.module';
import { DigitalAssetModule } from '../digital-asset/digital-asset.module';

@Module({
  imports: [
    forwardRef(() => OrderModule),
    CouponModule,
    NotificationModule,
    DigitalAssetModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService, AlipayService, WechatPayService, WebhookIpGuard],
  exports: [PaymentService, AlipayService, WechatPayService],
})
export class PaymentModule {}
