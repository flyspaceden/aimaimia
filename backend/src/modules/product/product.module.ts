import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';
import { ProductBundleService } from './product-bundle.service';
import { ProductPricingService } from './product-pricing.service';
import { ProductService } from './product.service';
import { SemanticFillService } from './semantic-fill.service';

@Module({
  controllers: [ProductController],
  providers: [ProductService, SemanticFillService, ProductBundleService, ProductPricingService],
  exports: [ProductService, SemanticFillService, ProductBundleService, ProductPricingService],
})
export class ProductModule {}
