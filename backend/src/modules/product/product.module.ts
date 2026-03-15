import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { SemanticFillService } from './semantic-fill.service';

@Module({
  controllers: [ProductController],
  providers: [ProductService, SemanticFillService],
  exports: [ProductService, SemanticFillService],
})
export class ProductModule {}
