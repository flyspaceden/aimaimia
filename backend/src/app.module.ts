import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductModule } from './modules/product/product.module';
import { CompanyModule } from './modules/company/company.module';
import { UserModule } from './modules/user/user.module';
import { OrderModule } from './modules/order/order.module';
import { BookingModule } from './modules/booking/booking.module';
import { GroupModule } from './modules/group/group.module';
import { FollowModule } from './modules/follow/follow.module';
import { TaskModule } from './modules/task/task.module';
import { CheckInModule } from './modules/check-in/check-in.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { AddressModule } from './modules/address/address.module';
import { CartModule } from './modules/cart/cart.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ShipmentModule } from './modules/shipment/shipment.module';
import { TraceModule } from './modules/trace/trace.module';
import { AiModule } from './modules/ai/ai.module';
import { BonusModule } from './modules/bonus/bonus.module';
import { UploadModule } from './modules/upload/upload.module';
import { AdminModule } from './modules/admin/admin.module';
import { SellerModule } from './modules/seller/seller.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { LotteryModule } from './modules/lottery/lottery.module';

import { CouponModule } from './modules/coupon/coupon.module';
import { BuyerAliasModule } from './modules/buyer-alias/buyer-alias.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { CaptchaModule } from './modules/captcha/captcha.module';
import { MerchantApplicationModule } from './modules/merchant-application/merchant-application.module';
import { DeferredLinkModule } from './modules/deferred-link/deferred-link.module';
import { AfterSaleModule } from './modules/after-sale/after-sale.module';
import { CustomerServiceModule } from './modules/customer-service/cs.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { InfraModule } from './common/infra/infra.module';
import { SmsModule } from './common/sms/sms.module';
import { EmailModule } from './common/email/email.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [
        // IP 维度全局限流（默认桶，供 @Throttle({ default: ... }) 覆盖）
        { name: 'default', ttl: 60000, limit: 60 },
        // 用户维度全局限流（登录后按 user/staff/admin 的 sub 分桶）
        { name: 'user', ttl: 60000, limit: 120 },
      ],
    }),
    ConfigModule,
    InfraModule,
    SmsModule,
    EmailModule,
    PrismaModule,
    AuthModule,
    ProductModule,
    CompanyModule,
    UserModule,
    OrderModule,
    BookingModule,
    GroupModule,
    FollowModule,
    TaskModule,
    CheckInModule,
    InboxModule,
    AddressModule,
    CartModule,
    PaymentModule,
    ShipmentModule,
    TraceModule,
    AiModule,
    BonusModule,
    UploadModule,
    AdminModule,
    SellerModule,
    RecommendationModule,
    LotteryModule,

    CouponModule,
    BuyerAliasModule,
    InvoiceModule,
    CaptchaModule,
    MerchantApplicationModule,
    DeferredLinkModule,
    AfterSaleModule,
    CustomerServiceModule,
  ],
  providers: [
    // 全局 JWT 守卫：所有端点默认需要认证，用 @Public() 装饰器豁免
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule {}
