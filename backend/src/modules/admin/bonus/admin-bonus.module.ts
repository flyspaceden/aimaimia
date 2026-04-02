import { Module } from '@nestjs/common';
import { AdminBonusController } from './admin-bonus.controller';
import { AdminBonusService } from './admin-bonus.service';

@Module({
  controllers: [AdminBonusController],
  providers: [AdminBonusService],
})
export class AdminBonusModule {}
