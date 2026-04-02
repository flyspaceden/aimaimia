import { Module } from '@nestjs/common';
import { ShipmentController } from './shipment.controller';
import { ShipmentService } from './shipment.service';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';

@Module({
  controllers: [ShipmentController],
  providers: [ShipmentService, WebhookIpGuard],
})
export class ShipmentModule {}
