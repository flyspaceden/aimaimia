import { Module } from '@nestjs/common';
import { BonusModule } from '../../bonus/bonus.module';
import { PaymentModule } from '../../payment/payment.module';
import { ShipmentModule } from '../../shipment/shipment.module';
import { UploadModule } from '../../upload/upload.module';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { PickupModule } from '../../pickup/pickup.module';
import { OrderModule } from '../../order/order.module';

@Module({
  imports: [BonusModule, ShipmentModule, UploadModule, PaymentModule, PickupModule, OrderModule],
  controllers: [AdminOrdersController],
  providers: [AdminOrdersService],
})
export class AdminOrdersModule {}
