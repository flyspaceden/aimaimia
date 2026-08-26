import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { ProductImageQualityService } from './product-image-quality.service';
import { SellerMediaAssetsController } from './seller-media-assets.controller';
import { SellerMediaAssetsService } from './seller-media-assets.service';
import { ProductMediaRevisionsController } from './product-media-revisions.controller';
import { ProductMediaRevisionsService } from './product-media-revisions.service';
import { AdminProductMediaRevisionsController } from './admin-product-media-revisions.controller';
import { ProductImageCompositionService } from './product-image-composition.service';
import { DisabledProductImageBackgroundProvider } from './product-image-background.provider';
import { ProductImageOptimizationService } from './product-image-optimization.service';
import { ProductImageOptimizationController } from './product-image-optimization.controller';
import { ProductImageBudgetService } from './product-image-budget.service';
import { ProductVisualPlanningController } from './product-visual-planning.controller';
import { ProductVisualPlanningService } from './product-visual-planning.service';

@Module({
  imports: [UploadModule],
  controllers: [SellerMediaAssetsController, ProductMediaRevisionsController, AdminProductMediaRevisionsController, ProductImageOptimizationController, ProductVisualPlanningController],
  providers: [ProductImageQualityService, SellerMediaAssetsService, ProductMediaRevisionsService, ProductImageCompositionService, ProductImageOptimizationService, ProductImageBudgetService, ProductVisualPlanningService, DisabledProductImageBackgroundProvider],
  exports: [ProductImageQualityService, SellerMediaAssetsService, ProductImageCompositionService],
})
export class ProductImageModule {}
