import { Module } from '@nestjs/common';
import { AdminProductsController } from './admin-products.controller';
import { AdminProductsService } from './admin-products.service';
import { ProductModule } from '../../product/product.module';
import { ProfitModule } from '../../profit/profit.module';

@Module({
  imports: [ProductModule, ProfitModule],
  controllers: [AdminProductsController],
  providers: [AdminProductsService],
})
export class AdminProductsModule {}
