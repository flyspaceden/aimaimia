import { Module } from '@nestjs/common';
import { SellerProductsController } from './seller-products.controller';
import { SellerProductsService } from './seller-products.service';
import { BonusModule } from '../../bonus/bonus.module';
import { ProductModule } from '../../product/product.module';
import { ProfitModule } from '../../profit/profit.module';
import { ProductImageModule } from '../../product-image/product-image.module';

@Module({
  imports: [BonusModule, ProductModule, ProfitModule, ProductImageModule],
  controllers: [SellerProductsController],
  providers: [SellerProductsService],
})
export class SellerProductsModule {}
