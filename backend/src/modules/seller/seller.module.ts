import { Module } from '@nestjs/common';
import { SellerAuthModule } from './auth/seller-auth.module';
import { SellerProductsModule } from './products/seller-products.module';
import { SellerOrdersModule } from './orders/seller-orders.module';
import { SellerAnalyticsModule } from './analytics/seller-analytics.module';
import { SellerCompanyModule } from './company/seller-company.module';
import { SellerShipmentsModule } from './shipments/seller-shipments.module';
import { SellerTraceModule } from './trace/seller-trace.module';

import { SellerConfigModule } from './config/seller-config.module';
import { SellerRefundsModule } from './refunds/seller-refunds.module';
import { VirtualCallModule } from './virtual-call/virtual-call.module';
import { SellerShippingModule } from './shipping/seller-shipping.module';
import { SellerAuditAlertModule } from './audit/seller-audit-alert.module';
import { SellerRiskControlModule } from './risk-control/seller-risk-control.module';
import { SellerAfterSaleModule } from './after-sale/seller-after-sale.module';

@Module({
  imports: [
    SellerRiskControlModule,
    SellerAfterSaleModule,
    SellerAuthModule,
    SellerProductsModule,
    SellerOrdersModule,
    SellerAnalyticsModule,
    SellerCompanyModule,
    SellerShipmentsModule,
    SellerShippingModule,
    SellerTraceModule,

    SellerRefundsModule,
    SellerConfigModule,
    VirtualCallModule,
    SellerAuditAlertModule,
  ],
})
export class SellerModule {}
