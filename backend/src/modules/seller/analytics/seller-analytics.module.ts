import { Module } from '@nestjs/common';
import { SellerAnalyticsController } from './seller-analytics.controller';
import { SellerAnalyticsService } from './seller-analytics.service';

@Module({
  controllers: [SellerAnalyticsController],
  providers: [SellerAnalyticsService],
})
export class SellerAnalyticsModule {}
