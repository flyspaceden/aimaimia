import { Module } from '@nestjs/common';
import { ShipmentController } from './shipment.controller';
import { ShipmentService } from './shipment.service';
import { ShipmentMonitorService } from './shipment-monitor.service';
import { SfExpressService } from './sf-express.service';
import { OrderShippingCostService } from './order-shipping-cost.service';
import { DeliverySfCallbackService } from './delivery-sf-callback.service';
import { NotificationModule } from '../notification/notification.module';
import { WechatMiniProgramPlatformModule } from '../wechat-mini-program-platform/wechat-mini-program-platform.module';
import { WechatShippingOutboxService } from './wechat-shipping-outbox.service';

@Module({
  imports: [NotificationModule, WechatMiniProgramPlatformModule],
  controllers: [ShipmentController],
  providers: [
    ShipmentService,
    ShipmentMonitorService,
    SfExpressService,
    OrderShippingCostService,
    DeliverySfCallbackService,
    WechatShippingOutboxService,
  ],
  exports: [SfExpressService, OrderShippingCostService, WechatShippingOutboxService],
})
export class ShipmentModule {}
