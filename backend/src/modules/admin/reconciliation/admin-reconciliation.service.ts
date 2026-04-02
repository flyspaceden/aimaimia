import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { sanitizeErrorForLog, sanitizeForLog } from '../../../common/logging/log-sanitizer';
import { TtlCache } from '../../../common/ttl-cache';
import { RedisCoordinatorService } from '../../../common/infra/redis-coordinator.service';

type ReconciliationTrigger = 'cron' | 'manual' | 'query';
type CheckSeverity = 'info' | 'warn' | 'error';

type DateWindow = {
  ymd: string;
  start: Date;
  end: Date;
};

type ReconciliationCheck = {
  key: string;
  label: string;
  severity: CheckSeverity;
  passed: boolean;
  details?: Record<string, unknown>;
};

@Injectable()
export class AdminReconciliationService {
  private readonly logger = new Logger(AdminReconciliationService.name);
  private readonly reportCache = new TtlCache<any>(5 * 60_000); // 5 分钟缓存，避免页面反复刷新打库
  private readonly amountTolerance = 0.01;
  private readonly cronLockKey = 'sys:cron:reconciliation:daily';
  private readonly cronLockTtlMs = 30 * 60_000; // 30 分钟锁租约（覆盖日报生成常见耗时）

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisCoord: RedisCoordinatorService,
  ) {}

  /** 每日 02:10 自动跑前一日对账（骨架版） */
  @Cron('0 10 2 * * *')
  async runDailyReconciliationCron() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = this.formatYmdLocal(yesterday);
    const redisOwner = `reco:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const redisLockKey = 'cron:admin-reconciliation:daily';

    try {
      // M12终态：优先使用 Redis 分布式锁（多实例、无长事务）；无 Redis 时回退 DB 行锁
      const redisLock = await this.redisCoord.acquireLock(redisLockKey, redisOwner, this.cronLockTtlMs);
      if (redisLock === false) {
        this.logger.log(`[Cron] 日对账任务 Redis 锁被其他实例持有，跳过 date=${date}`);
        return;
      }
      if (redisLock === true) {
        try {
          await this.generateDailyReport({
            date,
            trigger: 'cron',
            force: true,
          });
          return;
        } finally {
          await this.redisCoord.releaseLock(redisLockKey, redisOwner);
        }
      }

      const lockPrepared = await this.ensureCronLockRow();
      if (!lockPrepared) {
        this.logger.warn(`[Cron] 无法初始化对账锁行，跳过 date=${date}`);
        return;
      }

      const executed = await this.prisma.$transaction(async (tx) => {
        const lockRow = await tx.$queryRaw<{ key: string }[]>`
          SELECT key
          FROM "RuleConfig"
          WHERE key = ${this.cronLockKey}
          FOR UPDATE SKIP LOCKED
        `;

        if (lockRow.length === 0) {
          this.logger.log(`[Cron] 日对账任务锁被其他实例持有，跳过 date=${date}`);
          return false;
        }

        // 持有行锁期间执行对账，避免多实例重复执行
        await this.generateDailyReport({
          date,
          trigger: 'cron',
          force: true,
        });
        return true;
      });

      if (!executed) return;
    } catch (err) {
      const safeErr = sanitizeErrorForLog(err);
      this.logger.error(`[Cron] 日对账执行失败 date=${date}: ${safeErr.message}`, safeErr.stack);
    }
  }

  async getDailyReport(date?: string) {
    return this.generateDailyReport({ date, trigger: 'query' });
  }

  async runDailyReport(date?: string, adminUserId?: string) {
    return this.generateDailyReport({
      date,
      trigger: 'manual',
      force: true,
      triggeredByAdminId: adminUserId,
    });
  }

  private async generateDailyReport(options: {
    date?: string;
    trigger: ReconciliationTrigger;
    force?: boolean;
    triggeredByAdminId?: string;
  }) {
    const window = this.resolveDateWindow(options.date);
    const cacheKey = `daily:${window.ymd}`;

    if (!options.force) {
      const cached = this.reportCache.get(cacheKey);
      if (cached) {
        return {
          ...cached,
          meta: {
            ...cached.meta,
            cacheHit: true,
            trigger: options.trigger,
          },
        };
      }
    }

    const generatedAt = new Date();
    const [
      paymentSummary,
      refundSummary,
      rewardSummary,
      withdrawSummary,
      rewardChecks,
      withdrawChecks,
      withdrawMappingCheck,
    ] = await Promise.all([
      this.buildPaymentSummary(window),
      this.buildRefundSummary(window),
      this.buildRewardSummary(window),
      this.buildWithdrawSummary(window),
      this.checkRewardAccountConsistency(),
      this.checkWithdrawLedgerStateConsistency(),
      this.checkWithdrawLedgerMappings(window),
    ]);

    const heuristicChecks = this.buildHeuristicChecks({
      paymentSummary,
      refundSummary,
      rewardSummary,
      withdrawSummary,
    });

    const checks = [
      ...rewardChecks,
      ...withdrawChecks,
      withdrawMappingCheck,
      ...heuristicChecks,
    ];
    const failedChecks = checks.filter((c) => !c.passed);
    const errorCount = failedChecks.filter((c) => c.severity === 'error').length;
    const warnCount = failedChecks.filter((c) => c.severity === 'warn').length;

    const report = {
      date: window.ymd,
      meta: {
        trigger: options.trigger,
        cacheHit: false,
        generatedAt: generatedAt.toISOString(),
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'server-local',
        amountTolerance: this.amountTolerance,
        triggeredByAdminId: options.triggeredByAdminId ?? null,
        version: 'skeleton-v1',
        notes: [
          '当前为内部账务骨架对账（数据库聚合 + 差异检查 + 日志告警）。',
          '支付/退款渠道对账单（微信/支付宝）API/文件接入与逐笔核对待补充。',
          '退款“成功时间”当前以 Refund.updatedAt 近似，后续可切换到 RefundStatusHistory 精准口径。',
        ],
      },
      status: errorCount > 0 ? 'ERROR' : warnCount > 0 ? 'WARN' : 'OK',
      summary: {
        payment: paymentSummary,
        refund: refundSummary,
        reward: rewardSummary,
        withdraw: withdrawSummary,
      },
      checks,
      alerts: failedChecks.map((c) => ({
        key: c.key,
        severity: c.severity,
        label: c.label,
      })),
    };

    this.reportCache.set(cacheKey, report);
    this.logReportSummary(report);
    return report;
  }

  private async buildPaymentSummary(window: DateWindow) {
    const [paid, created, failedOrClosed] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          deletedAt: null,
          status: 'PAID',
          paidAt: { gte: window.start, lt: window.end },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          deletedAt: null,
          createdAt: { gte: window.start, lt: window.end },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['status'],
        where: {
          deletedAt: null,
          updatedAt: { gte: window.start, lt: window.end },
          status: { in: ['FAILED', 'CLOSED', 'REFUNDED', 'PART_REFUNDED'] },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const statusTouched = this.initStatusMap(['FAILED', 'CLOSED', 'REFUNDED', 'PART_REFUNDED']);
    for (const row of failedOrClosed) {
      statusTouched[row.status] = {
        count: row._count._all,
        amount: this.money(row._sum.amount),
      };
    }

    return {
      created: {
        count: created._count._all,
        amount: this.money(created._sum.amount),
      },
      paid: {
        count: paid._count._all,
        amount: this.money(paid._sum.amount),
      },
      statusTouched,
    };
  }

  private async buildRefundSummary(window: DateWindow) {
    const [created, statusTouched] = await Promise.all([
      this.prisma.refund.aggregate({
        where: {
          deletedAt: null,
          createdAt: { gte: window.start, lt: window.end },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.refund.groupBy({
        by: ['status'],
        where: {
          deletedAt: null,
          updatedAt: { gte: window.start, lt: window.end },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const statusMap = this.initStatusMap([
      'REQUESTED',
      'APPROVED',
      'REJECTED',
      'REFUNDING',
      'REFUNDED',
      'FAILED',
    ]);
    for (const row of statusTouched) {
      statusMap[row.status] = {
        count: row._count._all,
        amount: this.money(row._sum.amount),
      };
    }

    return {
      created: {
        count: created._count._all,
        amount: this.money(created._sum.amount),
      },
      statusTouched: statusMap,
      refundedSettledApprox: statusMap.REFUNDED,
    };
  }

  private async buildRewardSummary(window: DateWindow) {
    const rows = await this.prisma.rewardLedger.groupBy({
      by: ['entryType'],
      where: {
        deletedAt: null,
        createdAt: { gte: window.start, lt: window.end },
        account: { is: { type: 'VIP_REWARD' } },
      },
      _count: { _all: true },
      _sum: { amount: true },
    });

    const entryMap = this.initStatusMap(['FREEZE', 'RELEASE', 'WITHDRAW', 'VOID', 'ADJUST']);
    for (const row of rows) {
      entryMap[row.entryType] = {
        count: row._count._all,
        amount: this.money(row._sum.amount),
      };
    }

    return {
      entries: entryMap,
      distributedApprox: {
        count: entryMap.RELEASE.count,
        amount: entryMap.RELEASE.amount,
      },
    };
  }

  private async buildWithdrawSummary(window: DateWindow) {
    const [createdByStatus, statusTouched] = await Promise.all([
      this.prisma.withdrawRequest.groupBy({
        by: ['status'],
        where: {
          deletedAt: null,
          createdAt: { gte: window.start, lt: window.end },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.withdrawRequest.groupBy({
        by: ['status'],
        where: {
          deletedAt: null,
          updatedAt: { gte: window.start, lt: window.end },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const createdMap = this.initStatusMap(['REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'FAILED']);
    const touchedMap = this.initStatusMap(['REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'FAILED']);
    for (const row of createdByStatus) {
      createdMap[row.status] = {
        count: row._count._all,
        amount: this.money(row._sum.amount),
      };
    }
    for (const row of statusTouched) {
      touchedMap[row.status] = {
        count: row._count._all,
        amount: this.money(row._sum.amount),
      };
    }

    return {
      createdByStatus: createdMap,
      statusTouched: touchedMap,
    };
  }

  private async checkRewardAccountConsistency(): Promise<ReconciliationCheck[]> {
    const [accountAgg, availableLedgerAgg, frozenLedgerAgg] = await Promise.all([
      this.prisma.rewardAccount.aggregate({
        where: { type: 'VIP_REWARD' },
        _sum: { balance: true, frozen: true },
      }),
      this.prisma.rewardLedger.aggregate({
        where: {
          deletedAt: null,
          status: 'AVAILABLE',
          account: { is: { type: 'VIP_REWARD' } },
        },
        _sum: { amount: true },
      }),
      this.prisma.rewardLedger.aggregate({
        where: {
          deletedAt: null,
          status: 'FROZEN',
          account: { is: { type: 'VIP_REWARD' } },
        },
        _sum: { amount: true },
      }),
    ]);

    const accountBalance = this.money(accountAgg._sum.balance);
    const accountFrozen = this.money(accountAgg._sum.frozen);
    const ledgerAvailable = this.money(availableLedgerAgg._sum.amount);
    const ledgerFrozen = this.money(frozenLedgerAgg._sum.amount);

    return [
      this.buildAmountMatchCheck(
        'reward-account-vs-ledger-available',
        '奖励账户余额总和 vs 可用流水总和',
        accountBalance,
        ledgerAvailable,
      ),
      this.buildAmountMatchCheck(
        'reward-account-vs-ledger-frozen',
        '奖励账户冻结总和 vs 冻结流水总和',
        accountFrozen,
        ledgerFrozen,
      ),
    ];
  }

  private async checkWithdrawLedgerStateConsistency(): Promise<ReconciliationCheck[]> {
    const [
      requestedWr,
      requestedLedger,
      approvedPaidWr,
      withdrawnLedger,
    ] = await Promise.all([
      this.prisma.withdrawRequest.aggregate({
        where: { deletedAt: null, status: 'REQUESTED' },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.rewardLedger.aggregate({
        where: {
          deletedAt: null,
          refType: 'WITHDRAW',
          status: 'FROZEN',
          account: { is: { type: 'VIP_REWARD' } },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: { deletedAt: null, status: { in: ['APPROVED', 'PAID'] } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.rewardLedger.aggregate({
        where: {
          deletedAt: null,
          refType: 'WITHDRAW',
          status: 'WITHDRAWN',
          account: { is: { type: 'VIP_REWARD' } },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    return [
      this.buildCountMatchCheck(
        'withdraw-requested-count-vs-frozen-ledger-count',
        '待审核提现数量 vs 冻结提现流水数量',
        requestedWr._count._all,
        requestedLedger._count._all ?? 0,
      ),
      this.buildAmountMatchCheck(
        'withdraw-requested-amount-vs-frozen-ledger-amount',
        '待审核提现金额 vs 冻结提现流水金额',
        this.money(requestedWr._sum.amount),
        this.money(requestedLedger._sum.amount),
      ),
      this.buildCountMatchCheck(
        'withdraw-approved-paid-count-vs-withdrawn-ledger-count',
        '已审批/已打款提现数量 vs 已提现流水数量',
        approvedPaidWr._count._all,
        withdrawnLedger._count._all ?? 0,
      ),
      this.buildAmountMatchCheck(
        'withdraw-approved-paid-amount-vs-withdrawn-ledger-amount',
        '已审批/已打款提现金额 vs 已提现流水金额',
        this.money(approvedPaidWr._sum.amount),
        this.money(withdrawnLedger._sum.amount),
      ),
    ];
  }

  private async checkWithdrawLedgerMappings(window: DateWindow): Promise<ReconciliationCheck> {
    const where = {
      deletedAt: null as null,
      OR: [
        { createdAt: { gte: window.start, lt: window.end } },
        { updatedAt: { gte: window.start, lt: window.end } },
      ],
    };

    const sampleLimit = 200;
    const [totalTouched, touched] = await Promise.all([
      this.prisma.withdrawRequest.count({ where }),
      this.prisma.withdrawRequest.findMany({
        where,
        select: { id: true, amount: true, status: true },
        orderBy: { updatedAt: 'desc' },
        take: sampleLimit,
      }),
    ]);

    if (touched.length === 0) {
      return {
        key: 'withdraw-ledger-mapping-window-sample',
        label: '提现申请与提现流水映射抽样检查（窗口内）',
        severity: 'info',
        passed: true,
        details: { checkedCount: 0, totalTouched: 0, sampleLimit },
      };
    }

    const ledgers = await this.prisma.rewardLedger.findMany({
      where: {
        deletedAt: null,
        refType: 'WITHDRAW',
        refId: { in: touched.map((w) => w.id) },
      },
      select: {
        refId: true,
        amount: true,
        status: true,
        entryType: true,
      },
    });

    const ledgerByWithdrawId = new Map<string, typeof ledgers>();
    for (const ledger of ledgers) {
      if (!ledger.refId) continue;
      const arr = ledgerByWithdrawId.get(ledger.refId) ?? [];
      arr.push(ledger);
      ledgerByWithdrawId.set(ledger.refId, arr);
    }

    const mismatches: Array<Record<string, unknown>> = [];
    let checkedCount = 0;
    let skippedCount = 0;

    for (const wr of touched) {
      const expected = this.expectedWithdrawLedgerStatus(wr.status);
      if (!expected) {
        skippedCount++;
        continue;
      }
      checkedCount++;

      const related = ledgerByWithdrawId.get(wr.id) ?? [];
      const first = related[0];

      if (related.length !== 1) {
        mismatches.push({
          withdrawId: wr.id,
          status: wr.status,
          reason: related.length === 0 ? 'missing-ledger' : 'multiple-ledgers',
          ledgerCount: related.length,
        });
        continue;
      }

      const amountMatched = this.isAmountEqual(this.money(first.amount), this.money(wr.amount));
      const statusMatched = expected.ledgerStatuses.includes(first.status);
      const entryTypeMatched = expected.entryTypes.includes(first.entryType);

      if (!amountMatched || !statusMatched || !entryTypeMatched) {
        mismatches.push({
          withdrawId: wr.id,
          status: wr.status,
          expectedLedgerStatuses: expected.ledgerStatuses,
          expectedEntryTypes: expected.entryTypes,
          actualLedgerStatus: first.status,
          actualEntryType: first.entryType,
          expectedAmount: this.money(wr.amount),
          actualAmount: this.money(first.amount),
        });
      }
    }

    return {
      key: 'withdraw-ledger-mapping-window-sample',
      label: '提现申请与提现流水映射抽样检查（窗口内）',
      severity: mismatches.length > 0 ? 'warn' : 'info',
      passed: mismatches.length === 0,
      details: {
        totalTouched,
        checkedCount,
        skippedCount,
        sampleLimit,
        truncated: totalTouched > sampleLimit,
        mismatchCount: mismatches.length,
        examples: mismatches.slice(0, 10),
      },
    };
  }

  private buildHeuristicChecks(input: {
    paymentSummary: any;
    refundSummary: any;
    rewardSummary: any;
    withdrawSummary: any;
  }): ReconciliationCheck[] {
    const checks: ReconciliationCheck[] = [];

    const paidAmount = this.money(input.paymentSummary?.paid?.amount);
    const refundedAmount = this.money(input.refundSummary?.refundedSettledApprox?.amount);
    checks.push({
      key: 'window-refund-vs-payment-heuristic',
      label: '窗口内退款金额与支付金额启发式观察（非严格对账）',
      severity: 'info',
      passed: true,
      details: {
        paidAmount,
        refundedAmount,
        note: '退款金额可来自历史支付订单，本项仅用于快速观察趋势，不作为异常判定。',
      },
    });

    const releaseAmount = this.money(input.rewardSummary?.distributedApprox?.amount);
    const withdrawTouchedPaid = this.money(input.withdrawSummary?.statusTouched?.PAID?.amount);
    checks.push({
      key: 'window-reward-vs-withdraw-heuristic',
      label: '窗口内分润释放与提现打款启发式观察（非严格对账）',
      severity: 'info',
      passed: true,
      details: {
        rewardReleasedAmount: releaseAmount,
        withdrawPaidAmount: withdrawTouchedPaid,
        note: '提现打款通常滞后于分润释放，本项不作为异常判定。',
      },
    });

    return checks;
  }

  private expectedWithdrawLedgerStatus(withdrawStatus: string) {
    switch (withdrawStatus) {
      case 'REQUESTED':
        return { ledgerStatuses: ['FROZEN'], entryTypes: ['WITHDRAW'] };
      case 'APPROVED':
      case 'PAID':
        return { ledgerStatuses: ['WITHDRAWN'], entryTypes: ['WITHDRAW'] };
      case 'REJECTED':
        return { ledgerStatuses: ['VOIDED'], entryTypes: ['VOID'] };
      default:
        return null;
    }
  }

  private resolveDateWindow(date?: string): DateWindow {
    const base = date ? this.parseYmdLocal(date) : new Date();
    base.setHours(0, 0, 0, 0);
    const start = new Date(base);
    const end = new Date(base);
    end.setDate(end.getDate() + 1);
    return {
      ymd: this.formatYmdLocal(start),
      start,
      end,
    };
  }

  private parseYmdLocal(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('date 必须为 YYYY-MM-DD 格式');
    }
    const [y, m, d] = value.split('-').map((n) => parseInt(n, 10));
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() !== y ||
      date.getMonth() !== m - 1 ||
      date.getDate() !== d
    ) {
      throw new BadRequestException('date 非法');
    }
    return date;
  }

  private formatYmdLocal(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private buildAmountMatchCheck(
    key: string,
    label: string,
    leftAmount: number,
    rightAmount: number,
    severity: CheckSeverity = 'warn',
  ): ReconciliationCheck {
    const diff = this.money(leftAmount - rightAmount);
    const passed = Math.abs(diff) <= this.amountTolerance;
    return {
      key,
      label,
      severity: passed ? 'info' : severity,
      passed,
      details: {
        leftAmount: this.money(leftAmount),
        rightAmount: this.money(rightAmount),
        diff,
        tolerance: this.amountTolerance,
      },
    };
  }

  private buildCountMatchCheck(
    key: string,
    label: string,
    leftCount: number,
    rightCount: number,
    severity: CheckSeverity = 'warn',
  ): ReconciliationCheck {
    const diff = leftCount - rightCount;
    const passed = diff === 0;
    return {
      key,
      label,
      severity: passed ? 'info' : severity,
      passed,
      details: {
        leftCount,
        rightCount,
        diff,
      },
    };
  }

  private initStatusMap(keys: string[]) {
    return Object.fromEntries(
      keys.map((k) => [k, { count: 0, amount: 0 }]),
    ) as Record<string, { count: number; amount: number }>;
  }

  private money(value: number | null | undefined): number {
    return Number((value ?? 0).toFixed(2));
  }

  private isAmountEqual(a: number, b: number): boolean {
    return Math.abs(this.money(a - b)) <= this.amountTolerance;
  }

  private logReportSummary(report: any) {
    const message = `[DailyReconciliation] date=${report.date} status=${report.status} alerts=${report.alerts.length}`;
    if (report.status === 'OK') {
      this.logger.log(message);
      return;
    }

    const payload = sanitizeForLog({
      date: report.date,
      status: report.status,
      alerts: report.alerts,
      trigger: report.meta?.trigger,
    });
    this.logger.warn(`${message} details=${JSON.stringify(payload)}`);
  }

  /**
   * M12修复：用 RuleConfig 的固定行作为 DB 行锁载体（FOR UPDATE SKIP LOCKED）。
   * 行锁是事务级互斥，可在多实例部署时避免 Cron 同时执行。
   */
  private async ensureCronLockRow(): Promise<boolean> {
    try {
      await this.prisma.ruleConfig.upsert({
        where: { key: this.cronLockKey },
        create: {
          key: this.cronLockKey,
          value: {
            type: 'CRON_LOCK',
            job: 'admin-reconciliation-daily',
          },
        },
        update: {},
      });
      return true;
    } catch (err) {
      const safeErr = sanitizeErrorForLog(err);
      this.logger.error(`[CronLock] 初始化失败: ${safeErr.message}`, safeErr.stack);
      return false;
    }
  }
}
