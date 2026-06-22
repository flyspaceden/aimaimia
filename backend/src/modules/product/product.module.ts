import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';
import { ProductBundleService } from './product-bundle.service';
import { ProductService } from './product.service';
import { SemanticFillService } from './semantic-fill.service';

@Module({
  controllers: [ProductController],
  providers: [ProductService, SemanticFillService, ProductBundleService],
  exports: [ProductService, SemanticFillService, ProductBundleService],
})
export class ProductModule {}
