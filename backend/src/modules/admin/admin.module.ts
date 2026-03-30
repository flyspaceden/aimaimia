import { Module } from '@nestjs/common';
import { AdminAuthModule } from './auth/admin-auth.module';
import { AdminUsersModule } from './users/admin-users.module';
import { AdminRolesModule } from './roles/admin-roles.module';
import { AdminAuditModule } from './audit/admin-audit.module';
import { AdminStatsModule } from './stats/admin-stats.module';
import { AdminProductsModule } from './products/admin-products.module';
import { AdminOrdersModule } from './orders/admin-orders.module';
import { AdminCompaniesModule } from './companies/admin-companies.module';
import { AdminBonusModule } from './bonus/admin-bonus.module';
import { AdminTraceModule } from './trace/admin-trace.module';
import { AdminConfigModule } from './config/admin-config.module';
import { AdminAppUsersModule } from './app-users/admin-app-users.module';
import { AdminReconciliationModule } from './reconciliation/admin-reconciliation.module';
import { AdminLotteryModule } from './lottery/admin-lottery.module';
import { RewardProductModule } from './reward-product/reward-product.module';
import { ShippingRuleModule } from './shipping-rule/shipping-rule.module';
import { AdminReplacementsModule } from './replacements/admin-replacements.module';
import { AdminRefundsModule } from './refunds/admin-refunds.module';
import { AdminCouponModule } from './coupon/admin-coupon.module';
import { VipGiftModule } from './vip-gift/vip-gift.module';
import { VipPackageModule } from './vip-package/vip-package.module';
import { AdminCategoriesModule } from './categories/admin-categories.module';
import { AdminInvoicesModule } from './invoices/admin-invoices.module';
import { AdminMerchantApplicationsModule } from './merchant-applications/admin-merchant-applications.module';
import { AdminTagsModule } from './tags/admin-tags.module';
import { AdminAfterSaleModule } from './after-sale/admin-after-sale.module';

@Module({
  imports: [
    AdminAuthModule,
    AdminUsersModule,
    AdminAppUsersModule,
    AdminRolesModule,
    AdminAuditModule,
    AdminStatsModule,
    AdminProductsModule,
    AdminOrdersModule,
    AdminCompaniesModule,
    AdminBonusModule,
    AdminTraceModule,
    AdminConfigModule,
    AdminReconciliationModule,
    AdminLotteryModule,
    RewardProductModule,
    ShippingRuleModule,
    AdminReplacementsModule,
    AdminRefundsModule,
    AdminCouponModule,
    VipGiftModule,
    VipPackageModule,
    AdminCategoriesModule,
    AdminInvoicesModule,
    AdminMerchantApplicationsModule,
    AdminTagsModule,
    AdminAfterSaleModule,
  ],
})
export class AdminModule {}
