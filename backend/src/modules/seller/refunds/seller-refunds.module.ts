import { Module } from '@nestjs/common';
import { SellerRefundsController } from './seller-refunds.controller';
import { SellerRefundsService } from './seller-refunds.service';

@Module({
  controllers: [SellerRefundsController],
  providers: [SellerRefundsService],
})
export class SellerRefundsModule {}
