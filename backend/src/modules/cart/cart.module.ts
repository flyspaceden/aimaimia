import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { PrizeExpireService } from './prize-expire.service';
import { BonusModule } from '../bonus/bonus.module';
import { ProductModule } from '../product/product.module';

@Module({
  imports: [BonusModule, ProductModule],
  controllers: [CartController],
  providers: [CartService, PrizeExpireService],
  exports: [CartService],
})
export class CartModule {}
