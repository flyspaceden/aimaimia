import { Module } from '@nestjs/common';
import { ProductBundleService } from '../product/product-bundle.service';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';

@Module({
  controllers: [RecommendationController],
  providers: [RecommendationService, ProductBundleService],
})
export class RecommendationModule {}
