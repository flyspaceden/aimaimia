import { Module } from '@nestjs/common';
import { SellerRiskControlService } from './seller-risk-control.service';

@Module({
  providers: [SellerRiskControlService],
  exports: [SellerRiskControlService],
})
export class SellerRiskControlModule {}
