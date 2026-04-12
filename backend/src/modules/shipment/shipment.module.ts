import { Module } from '@nestjs/common';
import { ShipmentController } from './shipment.controller';
import { ShipmentService } from './shipment.service';
import { ShipmentMonitorService } from './shipment-monitor.service';
import { Kuaidi100Service } from './kuaidi100.service';
import { Kuaidi100WaybillService } from './kuaidi100-waybill.service';
import { SfExpressService } from './sf-express.service';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';
import { InboxModule } from '../inbox/inbox.module';

@Module({
  imports: [InboxModule],
  controllers: [ShipmentController],
  providers: [ShipmentService, ShipmentMonitorService, Kuaidi100Service, Kuaidi100WaybillService, SfExpressService, WebhookIpGuard],
  exports: [Kuaidi100Service, Kuaidi100WaybillService, SfExpressService],
})
export class ShipmentModule {}
