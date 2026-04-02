import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { PrizeExpireService } from './prize-expire.service';
import { BonusModule } from '../bonus/bonus.module';

@Module({
  imports: [BonusModule],
  controllers: [CartController],
  providers: [CartService, PrizeExpireService],
})
export class CartModule {}
