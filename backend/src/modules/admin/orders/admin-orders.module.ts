import { Module } from '@nestjs/common';
import { BonusModule } from '../../bonus/bonus.module';
import { PaymentModule } from '../../payment/payment.module';
import { ShipmentModule } from '../../shipment/shipment.module';
import { UploadModule } from '../../upload/upload.module';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';

@Module({
  imports: [BonusModule, ShipmentModule, UploadModule, PaymentModule],
  controllers: [AdminOrdersController],
  providers: [AdminOrdersService],
})
export class AdminOrdersModule {}
