import { Module } from '@nestjs/common';
import { SellerConfigController } from './seller-config.controller';
import { SellerConfigService } from './seller-config.service';
import { BonusModule } from '../../bonus/bonus.module';

@Module({
  imports: [BonusModule],
  controllers: [SellerConfigController],
  providers: [SellerConfigService],
})
export class SellerConfigModule {}
