import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * 卖家端审计日志异常模式自动告警服务
 *
 * 每 10 分钟扫描 SellerAuditLog，检测以下可疑行为模式：
 * 1. 单员工 10 分钟内查看 >50 个订单（过度浏览，可能数据爬取）
 * 2. 单员工 5 分钟内 >10 次高频重复操作（可能脚本自动化）
 * 3. 非营业时段操作（可配置，默认 UTC+8 06:00–23:00）
 *
 * 当前告警方式为日志输出（占位），后续可扩展为通知推送 / 企业微信 / 短信。
 */
@Injectable()
export class SellerAuditAlertService {
  private readonly logger = new Logger(SellerAuditAlertService.name);

  /** 营业时段起始小时（UTC+8，含） */
  private readonly businessHourStart = 6;
  /** 营业时段结束小时（UTC+8，不含） */
  private readonly businessHourEnd = 23;

  /** 10 分钟内查看订单数量阈值 */
  private readonly excessiveBrowseThreshold = 50;
  /** 5 分钟内高频重复操作阈值 */
  private readonly highFrequencyThreshold = 10;

  constructor(private readonly prisma: PrismaService) {}

  /** 每 10 分钟执行一次异常模式检测 */
  @Cron('0 */10 * * * *')
  async detectAnomalies(): Promise<void> {
    try {
      await Promise.all([
        this.checkExcessiveOrderBrowsing(),
        this.checkHighFrequencyOperations(),
        this.checkOffBusinessHoursActivity(),
      ]);
    } catch (err) {
      this.logger.error(
        `审计异常检测任务执行失败: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 检测过度浏览订单：10 分钟内同一员工查看 >50 个订单
   * 可能指示数据爬取或未授权批量导出行为
   */
  private async checkExcessiveOrderBrowsing(): Promise<void> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    // 按 staffId 分组，统计 VIEW_ORDER 操作次数
    const results = await this.prisma.sellerAuditLog.groupBy({
      by: ['staffId', 'companyId'],
      where: {
        action: 'VIEW_ORDER',
        createdAt: { gte: tenMinutesAgo },
      },
      _count: { id: true },
      having: {
        id: { _count: { gt: this.excessiveBrowseThreshold } },
      },
    });

    for (const r of results) {
      this.logger.warn(
        `[异常告警-过度浏览] 员工 ${r.staffId}（企业 ${r.companyId}）` +
          `在 10 分钟内查看了 ${r._count.id} 个订单，超过阈值 ${this.excessiveBrowseThreshold}`,
      );
      // TODO: 接入通知服务（企业微信 / 短信 / 站内信）
    }
  }

  /**
   * 检测高频重复操作：5 分钟内同一员工对同一操作类型执行 >10 次
   * 可能指示脚本自动化操作或异常重试行为
   */
  private async checkHighFrequencyOperations(): Promise<void> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // 按 staffId + action 分组，统计操作次数
    const results = await this.prisma.sellerAuditLog.groupBy({
      by: ['staffId', 'companyId', 'action'],
      where: {
        createdAt: { gte: fiveMinutesAgo },
      },
      _count: { id: true },
      having: {
        id: { _count: { gt: this.highFrequencyThreshold } },
      },
    });

    for (const r of results) {
      // VIEW_ORDER 已由 checkExcessiveOrderBrowsing 单独处理，此处跳过
      if (r.action === 'VIEW_ORDER') continue;

      this.logger.warn(
        `[异常告警-高频操作] 员工 ${r.staffId}（企业 ${r.companyId}）` +
          `在 5 分钟内执行了 ${r._count.id} 次 "${r.action}" 操作，超过阈值 ${this.highFrequencyThreshold}`,
      );
      // TODO: 接入通知服务
    }
  }

  /**
   * 检测非营业时段操作：UTC+8 06:00–23:00 之外的操作
   * 深夜 / 凌晨操作可能指示账号被盗用或内部人员违规
   */
  private async checkOffBusinessHoursActivity(): Promise<void> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    // 获取当前 UTC+8 小时
    const nowUtc8Hour = this.getUtc8Hour(new Date());

    // 仅在非营业时段运行此检测（营业时段内不需要告警）
    if (
      nowUtc8Hour >= this.businessHourStart &&
      nowUtc8Hour < this.businessHourEnd
    ) {
      return;
    }

    // 查询最近 10 分钟内的操作（此时已确认是非营业时段）
    const results = await this.prisma.sellerAuditLog.groupBy({
      by: ['staffId', 'companyId'],
      where: {
        createdAt: { gte: tenMinutesAgo },
      },
      _count: { id: true },
    });

    for (const r of results) {
      this.logger.warn(
        `[异常告警-非营业时段] 员工 ${r.staffId}（企业 ${r.companyId}）` +
          `在非营业时段（当前 UTC+8 ${nowUtc8Hour}:00，营业时段 ${this.businessHourStart}:00–${this.businessHourEnd}:00）` +
          `执行了 ${r._count.id} 次操作`,
      );
      // TODO: 接入通知服务
    }
  }

  /**
   * 获取指定时间的 UTC+8 小时（0–23）
   */
  private getUtc8Hour(date: Date): number {
    // UTC 小时 + 8，处理跨日
    return (date.getUTCHours() + 8) % 24;
  }
}
