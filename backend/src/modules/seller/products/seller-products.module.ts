import { Module } from '@nestjs/common';
import { SellerProductsController } from './seller-products.controller';
import { SellerProductsService } from './seller-products.service';
import { BonusModule } from '../../bonus/bonus.module';
import { ProductModule } from '../../product/product.module';

@Module({
  imports: [BonusModule, ProductModule],
  controllers: [SellerProductsController],
  providers: [SellerProductsService],
})
export class SellerProductsModule {}
