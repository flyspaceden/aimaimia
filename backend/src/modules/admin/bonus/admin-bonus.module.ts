import { Module } from '@nestjs/common';
import { AdminBonusController } from './admin-bonus.controller';
import { AdminBonusService } from './admin-bonus.service';
import { NotificationModule } from '../../notification/notification.module';
import { BonusModule } from '../../bonus/bonus.module';
import { PaymentModule } from '../../payment/payment.module';

@Module({
  // BonusModule 已导出 BonusConfigService，admin-bonus.service 用于
  // 计算前端展示的"已解锁层级"（vipMaxLayers 上限）
  imports: [NotificationModule, BonusModule, PaymentModule],
  controllers: [AdminBonusController],
  providers: [AdminBonusService],
})
export class AdminBonusModule {}
