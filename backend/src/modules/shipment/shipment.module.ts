import { Module } from '@nestjs/common';
import { ShipmentController } from './shipment.controller';
import { ShipmentService } from './shipment.service';
import { ShipmentMonitorService } from './shipment-monitor.service';
import { SfExpressService } from './sf-express.service';
import { InboxModule } from '../inbox/inbox.module';

@Module({
  imports: [InboxModule],
  controllers: [ShipmentController],
  providers: [ShipmentService, ShipmentMonitorService, SfExpressService],
  exports: [SfExpressService],
})
export class ShipmentModule {}
