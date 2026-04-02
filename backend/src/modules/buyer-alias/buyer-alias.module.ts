import { Module } from '@nestjs/common';
import { BuyerAliasService } from './buyer-alias.service';

@Module({
  providers: [BuyerAliasService],
  exports: [BuyerAliasService],
})
export class BuyerAliasModule {}
