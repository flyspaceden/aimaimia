import { Module } from '@nestjs/common';
import { SellerAfterSaleController } from './seller-after-sale.controller';
import { SellerAfterSaleService } from './seller-after-sale.service';
import { SellerShippingModule } from '../shipping/seller-shipping.module';
import { PaymentModule } from '../../payment/payment.module';
import { AfterSaleModule } from '../../after-sale/after-sale.module';
import { InboxModule } from '../../inbox/inbox.module';

@Module({
  imports: [SellerShippingModule, PaymentModule, AfterSaleModule, InboxModule],
  controllers: [SellerAfterSaleController],
  providers: [SellerAfterSaleService],
})
export class SellerAfterSaleModule {}
