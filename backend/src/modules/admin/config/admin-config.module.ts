import { Module } from '@nestjs/common';
import { BonusModule } from '../../bonus/bonus.module';
import { ProfitModule } from '../../profit/profit.module';
import { ProductModule } from '../../product/product.module';
import { AdminConfigController } from './admin-config.controller';
import { AdminConfigService } from './admin-config.service';

@Module({
  imports: [BonusModule, ProfitModule, ProductModule],
  controllers: [AdminConfigController],
  providers: [AdminConfigService],
})
export class AdminConfigModule {}
