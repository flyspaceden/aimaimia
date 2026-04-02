import { Module } from '@nestjs/common';
import { SellerAuditAlertService } from './seller-audit-alert.service';

/**
 * 卖家端审计日志异常告警模块
 *
 * 定时扫描审计日志，检测可疑行为模式并输出告警。
 * PrismaService 由全局 PrismaModule 提供，无需单独导入。
 * ScheduleModule 已在 AppModule 中注册 forRoot()。
 */
@Module({
  providers: [SellerAuditAlertService],
  exports: [SellerAuditAlertService],
})
export class SellerAuditAlertModule {}
