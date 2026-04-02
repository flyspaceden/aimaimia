import { Module } from '@nestjs/common';
import { RewardProductController } from './reward-product.controller';
import { RewardProductService } from './reward-product.service';

@Module({
  controllers: [RewardProductController],
  providers: [RewardProductService],
})
export class RewardProductModule {}
