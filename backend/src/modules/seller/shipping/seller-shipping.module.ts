import { Module } from '@nestjs/common';
import { SellerShippingController } from './seller-shipping.controller';
import { SellerShippingService } from './seller-shipping.service';
import { SellerRiskControlModule } from '../risk-control/seller-risk-control.module';
import { ShipmentModule } from '../../shipment/shipment.module';

@Module({
  imports: [SellerRiskControlModule, ShipmentModule],
  controllers: [SellerShippingController],
  providers: [SellerShippingService],
  exports: [SellerShippingService],
})
export class SellerShippingModule {}
