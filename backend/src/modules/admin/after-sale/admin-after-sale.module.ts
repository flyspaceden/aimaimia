import { Module } from '@nestjs/common';
import { AdminAfterSaleController } from './admin-after-sale.controller';
import { AdminAfterSaleService } from './admin-after-sale.service';
import { PaymentModule } from '../../payment/payment.module';
import { AfterSaleModule } from '../../after-sale/after-sale.module';
import { InboxModule } from '../../inbox/inbox.module';
import { ShipmentModule } from '../../shipment/shipment.module';

@Module({
  imports: [PaymentModule, AfterSaleModule, InboxModule, ShipmentModule],
  controllers: [AdminAfterSaleController],
  providers: [AdminAfterSaleService],
})
export class AdminAfterSaleModule {}
