import { Module } from '@nestjs/common';
import { SellerShippingController } from './seller-shipping.controller';
import { SellerShippingService } from './seller-shipping.service';
import { SellerRiskControlModule } from '../risk-control/seller-risk-control.module';
import { ShipmentModule } from '../../shipment/shipment.module';
import { UploadModule } from '../../upload/upload.module';
import { InboxModule } from '../../inbox/inbox.module';

@Module({
  imports: [SellerRiskControlModule, ShipmentModule, UploadModule, InboxModule],
  controllers: [SellerShippingController],
  providers: [SellerShippingService],
  exports: [SellerShippingService],
})
export class SellerShippingModule {}
