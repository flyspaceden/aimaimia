import { Module } from '@nestjs/common';
import { ShipmentController } from './shipment.controller';
import { ShipmentService } from './shipment.service';
import { ShipmentMonitorService } from './shipment-monitor.service';
import { SfExpressService } from './sf-express.service';
import { OrderShippingCostService } from './order-shipping-cost.service';
import { DeliverySfCallbackService } from './delivery-sf-callback.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [ShipmentController],
  providers: [
    ShipmentService,
    ShipmentMonitorService,
    SfExpressService,
    OrderShippingCostService,
    DeliverySfCallbackService,
  ],
  exports: [SfExpressService, OrderShippingCostService],
})
export class ShipmentModule {}
