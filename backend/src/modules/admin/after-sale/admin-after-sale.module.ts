import { Module } from '@nestjs/common';
import { AdminAfterSaleController } from './admin-after-sale.controller';
import { AdminAfterSaleService } from './admin-after-sale.service';
import { PaymentModule } from '../../payment/payment.module';

@Module({
  imports: [PaymentModule],
  controllers: [AdminAfterSaleController],
  providers: [AdminAfterSaleService],
})
export class AdminAfterSaleModule {}
