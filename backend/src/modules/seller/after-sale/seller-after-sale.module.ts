import { Module } from '@nestjs/common';
import { SellerAfterSaleController } from './seller-after-sale.controller';
import { SellerAfterSaleService } from './seller-after-sale.service';
import { SellerShippingModule } from '../shipping/seller-shipping.module';
import { PaymentModule } from '../../payment/payment.module';

@Module({
  imports: [SellerShippingModule, PaymentModule],
  controllers: [SellerAfterSaleController],
  providers: [SellerAfterSaleService],
})
export class SellerAfterSaleModule {}
