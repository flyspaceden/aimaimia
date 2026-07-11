import { Module } from '@nestjs/common';
import { CaptainModule } from '../../captain/captain.module';
import { ProfitModule } from '../../profit/profit.module';
import { AdminCaptainController } from './admin-captain.controller';
import { AdminCaptainService } from './admin-captain.service';

@Module({
  imports: [CaptainModule, ProfitModule],
  controllers: [AdminCaptainController],
  providers: [AdminCaptainService],
  exports: [AdminCaptainService],
})
export class AdminCaptainModule {}
