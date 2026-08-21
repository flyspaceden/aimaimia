import { Module } from '@nestjs/common';
import { BonusModule } from '../../bonus/bonus.module';
import { SellerOrdersController } from './seller-orders.controller';
import { SellerOrdersService } from './seller-orders.service';
import { SellerShippingModule } from '../shipping/seller-shipping.module';
import { SellerRiskControlModule } from '../risk-control/seller-risk-control.module';
import { NotificationModule } from '../../notification/notification.module';
import { ShipmentModule } from '../../shipment/shipment.module';
import { PickupModule } from '../../pickup/pickup.module';

@Module({
  imports: [
    BonusModule,
    SellerShippingModule,
    SellerRiskControlModule,
    NotificationModule,
    ShipmentModule,
    PickupModule,
  ],
  controllers: [SellerOrdersController],
  providers: [SellerOrdersService],
})
export class SellerOrdersModule {}
