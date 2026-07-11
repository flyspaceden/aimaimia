import { Module } from '@nestjs/common';
import { BonusModule } from '../../bonus/bonus.module';
import { ProfitModule } from '../../profit/profit.module';
import { AdminConfigController } from './admin-config.controller';
import { AdminConfigService } from './admin-config.service';

@Module({
  imports: [BonusModule, ProfitModule],
  controllers: [AdminConfigController],
  providers: [AdminConfigService],
})
export class AdminConfigModule {}
