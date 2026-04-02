import { Module } from '@nestjs/common';
import { SellerShipmentsController } from './seller-shipments.controller';
import { SellerShipmentsService } from './seller-shipments.service';

@Module({
  controllers: [SellerShipmentsController],
  providers: [SellerShipmentsService],
})
export class SellerShipmentsModule {}
