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
import { VisualAgentModule } from '../visual-agent/visual-agent.module';
import { ProductImageFactScanController } from './product-image-fact-scan.controller';
import { ProductImageFactScanService } from './product-image-fact-scan.service';
import { ProductImageBarcodeScannerService } from './product-image-barcode-scanner.service';
import { AdminVisualAgentClientController } from '../visual-agent/admin-visual-agent-client.controller';

@Module({
  imports: [UploadModule, VisualAgentModule],
  controllers: [SellerMediaAssetsController, ProductMediaRevisionsController, AdminProductMediaRevisionsController, ProductImageOptimizationController, ProductVisualPlanningController, ProductImageFactScanController, AdminVisualAgentClientController],
  providers: [ProductImageQualityService, SellerMediaAssetsService, ProductMediaRevisionsService, ProductImageCompositionService, ProductImageOptimizationService, ProductImageBudgetService, ProductVisualPlanningService, ProductImageFactScanService, ProductImageBarcodeScannerService, DisabledProductImageBackgroundProvider],
  exports: [ProductImageQualityService, SellerMediaAssetsService, ProductImageCompositionService],
})
export class ProductImageModule {}
