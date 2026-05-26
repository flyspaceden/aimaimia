import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';
import { decryptJsonValue, encryptJsonValue } from '../../common/security/encryption';
import { InboxService } from '../inbox/inbox.service';
import { AlipayService } from '../payment/alipay.service';
import { PaymentService } from '../payment/payment.service';
import { WithdrawDto } from './dto/withdraw.dto';
import type { WithdrawRules } from './dto/withdraw-rules.dto';
import { WithdrawRulesService } from './withdraw-rules.service';

type WithdrawStatusResult = 'PROCESSING' | 'PAID' | 'FAILED';

type TransferProviderResult = {
  success: boolean;
  processing: boolean;
  providerOrderId?: string;
  providerFundOrderId?: string;
  providerStatus?: string;
  errorCode?: string;
  errorMessage?: string;
};

type TransferPaymentService = PaymentService & {
  initiateTransfer(params: {
    channel: 'ALIPAY' | 'WECHAT_PAY' | 'UNIONPAY' | 'AGGREGATOR';
    amount: number;
    outBizNo: string;
    payeeAccount: string;
    payeeRealName: string;
    remark?: string;
  }): Promise<TransferProviderResult>;
};

type WithdrawResult = {
  withdrawId: string;
  grossAmount: number;
  taxAmount: number;
  taxRate: number;
  netAmount: number;
  status: WithdrawStatusResult;
  message: string;
};

type WithdrawSplit = {
  fromVipCents: number;
  fromNormalCents: number;
  fromIndustryFundCents: number;
  vipAccountId?: string;
  normalAccountId?: string;
  industryFundAccountId?: string;
};

const yuanToCents = (amount: number) => Math.round(amount * 100);
const centsToYuan = (cents: number) => Math.round(cents) / 100;

@Injectable()
export class WithdrawPayoutService implements OnModuleInit {
  private readonly logger = new Logger(WithdrawPayoutService.name);
  private paymentService?: TransferPaymentService;
  private alipayService?: AlipayService;

  constructor(
    private prisma: PrismaService,
    private rulesService: WithdrawRulesService,
    private inboxService: InboxService,
    private moduleRef: ModuleRef,
    private redisCoordinator: RedisCoordinatorService,
  ) {}

  onModuleInit() {
    this.paymentService = this.moduleRef.get(PaymentService, { strict: false }) as TransferPaymentService;
    this.alipayService = this.moduleRef.get(AlipayService, { strict: false });
  }

  async requestWithdraw(
    userId: string,
    input: WithdrawDto,
    idempotencyKey?: string,
  ): Promise<WithdrawResult> {
    const rules = await this.rulesService.getRules();
    const amountCents = yuanToCents(input.amount);

    if (amountCents < yuanToCents(rules.withdrawMinAmount)) {
      throw new BadRequestException(`单笔最低 ¥${rules.withdrawMinAmount}`);
    }
    if (amountCents > yuanToCents(rules.withdrawMaxAmount)) {
      throw new BadRequestException(`单笔最高 ¥${rules.withdrawMaxAmount}`);
    }

    if (idempotencyKey) {
      const existing = await (this.prisma.withdrawRequest as any).findUnique({
        where: { clientIdempotencyKey: idempotencyKey },
      });
      if (existing) {
        this.assertIdempotentRetryMatches(existing, userId, input, amountCents);
        return this.mapWithdrawResult(existing, '请求已处理');
      }
    }

    let created: any;
    try {
      created = await this.createWithdrawTx(userId, input, idempotencyKey, rules);
    } catch (err: any) {
      if (this.isUniqueConstraintError(err) && idempotencyKey) {
        const existing = await (this.prisma.withdrawRequest as any).findUnique({
          where: { clientIdempotencyKey: idempotencyKey },
        });
        if (existing) {
          this.assertIdempotentRetryMatches(existing, userId, input, amountCents);
          return this.mapWithdrawResult(existing, '请求已处理');
        }
      }
      throw err;
    }
    const grossNet = {
      grossAmount: created.amount,
      taxAmount: created.taxAmount,
      taxRate: created.taxRate,
      netAmount: created.netAmount,
    };

    let transferResult: TransferProviderResult;
    try {
      transferResult = await this.resolvePaymentService().initiateTransfer({
        channel: 'ALIPAY',
        amount: created.netAmount,
        outBizNo: created.outBizNo!,
        payeeAccount: input.alipayAccount,
        payeeRealName: input.alipayName,
        remark: '爱买买消费积分提现',
      });
    } catch (err: any) {
      const errorMessage = err?.message || '渠道请求异常';
      this.logger.error(`提现渠道请求异常: withdrawId=${created.id}, error=${errorMessage}`);
      await this.markProcessingProviderInfo(created.id, {
        providerStatus: 'UNKNOWN',
        errorCode: 'PROVIDER_EXCEPTION',
        errorMessage,
      });
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'PROCESSING',
        message: '提现处理中，请稍后查看',
      };
    }

    if (transferResult.success) {
      await this.finalizeWithdrawalPaid(created.id, transferResult);
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'PAID',
        message: `提现已到账 ¥${created.netAmount.toFixed(2)}`,
      };
    }

    if (!transferResult.processing) {
      await this.finalizeWithdrawalFailed(created.id, transferResult);
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'FAILED',
        message: `提现失败，金额已退回：${transferResult.errorMessage || '渠道处理失败'}`,
      };
    }

    await this.markProcessingProviderInfo(created.id, transferResult);
    return {
      withdrawId: created.id,
      ...grossNet,
      status: 'PROCESSING',
      message: '提现处理中，请稍后查看',
    };
  }

  async deductBalanceForWithdraw(
    tx: any,
    userId: string,
    amountCents: number,
  ): Promise<WithdrawSplit> {
    // 优先级：VIP_REWARD → NORMAL_REWARD → INDUSTRY_FUND（产业基金最后扣）
    const vip = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'VIP_REWARD' as any } },
    });
    const normal = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'NORMAL_REWARD' as any } },
    });
    const industry = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'INDUSTRY_FUND' as any } },
    });

    const vipBalanceCents = vip ? yuanToCents(vip.balance) : 0;
    const normalBalanceCents = normal ? yuanToCents(normal.balance) : 0;
    const industryBalanceCents = industry ? yuanToCents(industry.balance) : 0;
    if (vipBalanceCents + normalBalanceCents + industryBalanceCents < amountCents) {
      throw new BadRequestException('余额不足');
    }

    const fromVipCents = Math.min(vipBalanceCents, amountCents);
    let remaining = amountCents - fromVipCents;
    const fromNormalCents = Math.min(normalBalanceCents, remaining);
    remaining -= fromNormalCents;
    const fromIndustryFundCents = Math.min(industryBalanceCents, remaining);

    if (fromVipCents > 0 && vip) {
      const amount = centsToYuan(fromVipCents);
      const cas = await tx.rewardAccount.updateMany({
        where: { id: vip.id, balance: { gte: amount } },
        data: {
          balance: { decrement: amount },
          frozen: { increment: amount },
        },
      });
      if (cas.count !== 1) {
        throw new BadRequestException('VIP 余额扣减并发失败，请重试');
      }
    }

    if (fromNormalCents > 0 && normal) {
      const amount = centsToYuan(fromNormalCents);
      const cas = await tx.rewardAccount.updateMany({
        where: { id: normal.id, balance: { gte: amount } },
        data: {
          balance: { decrement: amount },
          frozen: { increment: amount },
        },
      });
      if (cas.count !== 1) {
        throw new BadRequestException('普通余额扣减并发失败，请重试');
      }
    }

    if (fromIndustryFundCents > 0 && industry) {
      const amount = centsToYuan(fromIndustryFundCents);
      const cas = await tx.rewardAccount.updateMany({
        where: { id: industry.id, balance: { gte: amount } },
        data: {
          balance: { decrement: amount },
          frozen: { increment: amount },
        },
      });
      if (cas.count !== 1) {
        throw new BadRequestException('产业基金余额扣减并发失败，请重试');
      }
    }

    return {
      fromVipCents,
      fromNormalCents,
      fromIndustryFundCents,
      vipAccountId: vip?.id,
      normalAccountId: normal?.id,
      industryFundAccountId: industry?.id,
    };
  }

  async finalizeWithdrawalPaid(
    withdrawId: string,
    providerResult: {
      providerOrderId?: string;
      providerFundOrderId?: string;
      providerStatus?: string;
    },
  ): Promise<void> {
    const withdraw = await this.prisma.$transaction(async (tx: any) => {
      const cas = await tx.withdrawRequest.updateMany({
        where: { id: withdrawId, status: 'PROCESSING' as any },
        data: {
          status: 'PAID' as any,
          providerPayoutId: providerResult.providerOrderId,
          providerFundOrderId: providerResult.providerFundOrderId,
          providerStatus: providerResult.providerStatus,
          paidAt: new Date(),
        },
      });
      if (cas.count === 0) return null;

      const current = await tx.withdrawRequest.findUnique({ where: { id: withdrawId } });
      const ledgers = await tx.rewardLedger.findMany({
        where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' as any },
      });

      for (const ledger of ledgers) {
        const release = await tx.rewardAccount.updateMany({
          where: { id: ledger.accountId, frozen: { gte: ledger.amount } },
          data: { frozen: { decrement: ledger.amount } },
        });
        if (release.count !== 1) {
          throw new InternalServerErrorException('提现冻结余额释放失败');
        }
      }

      await tx.rewardLedger.updateMany({
        where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' as any },
        data: { status: 'WITHDRAWN' as any },
      });

      return current;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (withdraw) {
      this.inboxService.send({
        userId: withdraw.userId,
        category: 'transaction',
        type: 'withdraw_paid',
        title: '提现已到账',
        content: `您的提现 ¥${withdraw.netAmount.toFixed(2)} 已到账支付宝（代扣个税 ¥${withdraw.taxAmount.toFixed(2)}）。`,
        target: { route: '/me/wallet' },
      }).catch((err) => this.logger.warn(`提现到账通知发送失败: ${err?.message ?? err}`));

      this.rulesService.getRules()
        .then((rules) => this.checkYearlyAlertAndNotify(withdraw.userId, withdraw.amount, rules))
        .catch((err) => this.logger.warn(`提现年度告警检查失败: ${err?.message ?? err}`));
    }
  }

  async finalizeWithdrawalFailed(
    withdrawId: string,
    providerResult: {
      errorMessage?: string;
      errorCode?: string;
      providerStatus?: string;
    },
  ): Promise<void> {
    const withdraw = await this.prisma.$transaction(async (tx: any) => {
      const cas = await tx.withdrawRequest.updateMany({
        where: { id: withdrawId, status: 'PROCESSING' as any },
        data: {
          status: 'FAILED' as any,
          providerErrorCode: providerResult.errorCode,
          providerErrorMessage: providerResult.errorMessage,
          providerStatus: providerResult.providerStatus,
        },
      });
      if (cas.count === 0) return null;

      const current = await tx.withdrawRequest.findUnique({ where: { id: withdrawId } });
      const ledgers = await tx.rewardLedger.findMany({
        where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' as any },
      });

      for (const ledger of ledgers) {
        const restore = await tx.rewardAccount.updateMany({
          where: { id: ledger.accountId, frozen: { gte: ledger.amount } },
          data: {
            frozen: { decrement: ledger.amount },
            balance: { increment: ledger.amount },
          },
        });
        if (restore.count !== 1) {
          throw new InternalServerErrorException('提现失败余额回滚失败');
        }
      }

      await tx.rewardLedger.updateMany({
        where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' as any },
        data: { status: 'VOIDED' as any, entryType: 'VOID' as any },
      });

      return current;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (withdraw) {
      this.inboxService.send({
        userId: withdraw.userId,
        category: 'transaction',
        type: 'withdraw_failed',
        title: '提现失败，金额已退回',
        content: `提现 ¥${withdraw.amount.toFixed(2)} 失败：${providerResult.errorMessage || '请检查账户信息后重试'}。`,
        target: { route: '/me/wallet' },
      }).catch((err) => this.logger.warn(`提现失败通知发送失败: ${err?.message ?? err}`));
    }
  }

  async markProcessingProviderInfo(
    withdrawId: string,
    providerResult: {
      errorCode?: string;
      errorMessage?: string;
      providerStatus?: string;
    },
  ): Promise<void> {
    const updated = await (this.prisma.withdrawRequest as any).update({
      where: { id: withdrawId },
      data: {
        providerErrorCode: providerResult.errorCode,
        providerErrorMessage: providerResult.errorMessage,
        providerStatus: providerResult.providerStatus,
      },
    });

    if (updated?.userId) {
      this.inboxService.send({
        userId: updated.userId,
        category: 'transaction',
        type: 'withdraw_processing',
        title: '提现处理中',
        content: `您的提现 ¥${updated.amount.toFixed(2)} 已提交渠道处理，请稍后查看。`,
        target: { route: '/me/wallet' },
      }).catch((err) => this.logger.warn(`提现处理中通知发送失败: ${err?.message ?? err}`));
    }
  }

  async checkYearlyAlertAndNotify(
    userId: string,
    _lastAmount: number,
    rules: Pick<WithdrawRules, 'withdrawYearlyMaxAmount' | 'withdrawYearlyAlertThreshold'>,
  ): Promise<void> {
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const agg = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId,
        createdAt: { gte: yearStart },
        status: { in: ['PROCESSING', 'PAID'] as any },
      },
      _sum: { amount: true },
    });
    const total = agg._sum.amount || 0;
    const threshold = rules.withdrawYearlyMaxAmount * rules.withdrawYearlyAlertThreshold;
    if (total < threshold || total >= rules.withdrawYearlyMaxAmount) return;

    this.logger.warn(
      `高额提现告警: userId=${userId}, yearlyTotal=${total.toFixed(2)}, limit=${rules.withdrawYearlyMaxAmount}`,
    );
    const content =
      `用户 ${userId} 本年累计提现 ¥${total.toFixed(2)}，已达年度上限的 ${(total / rules.withdrawYearlyMaxAmount * 100).toFixed(1)}%。`;
    await this.inboxService.send({
      userId,
      category: 'risk',
      type: 'withdraw_yearly_alert',
      title: '提现额度提醒',
      content: content.replace(`用户 ${userId} `, '您'),
      target: { route: '/me/wallet' },
    }).catch((err) => this.logger.warn(`提现额度提醒发送失败: ${err?.message ?? err}`));
    await this.createAdminYearlyAlertLogs(userId, total, rules.withdrawYearlyMaxAmount, content);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async retryProcessingWithdrawals(): Promise<void> {
    const lockKey = 'cron:withdraw-payout-retry';
    const lockOwner = randomUUID();
    const lockTtlMs = 9 * 60 * 1000;
    const gotLock = await this.redisCoordinator.acquireLock(lockKey, lockOwner, lockTtlMs);
    if (!gotLock) {
      this.logger.log('另一实例正在跑提现补偿，跳过');
      return;
    }

    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const candidates = await (this.prisma.withdrawRequest as any).findMany({
        where: {
          deletedAt: null,
          status: 'PROCESSING' as any,
          createdAt: { lte: fiveMinAgo },
          outBizNo: { not: null },
        },
        select: {
          id: true,
          outBizNo: true,
          queryAttempts: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      if (candidates.length === 0) return;

      const alipayService = this.resolveAlipayService();
      for (const withdraw of candidates) {
        await (this.prisma.withdrawRequest as any).update({
          where: { id: withdraw.id },
          data: { lastQueriedAt: new Date(), queryAttempts: { increment: 1 } },
        });

        try {
          const queryResult = await alipayService.queryTransfer({ outBizNo: withdraw.outBizNo });

          if (queryResult.status === 'SUCCESS') {
            await this.finalizeWithdrawalPaid(withdraw.id, {
              providerOrderId: queryResult.orderId,
              providerFundOrderId: queryResult.payFundOrderId,
              providerStatus: 'SUCCESS',
            });
          } else if (queryResult.status === 'FAIL') {
            await this.finalizeWithdrawalFailed(withdraw.id, {
              errorCode: queryResult.errorCode,
              errorMessage: queryResult.errorMessage,
              providerStatus: 'FAIL',
            });
          } else if (queryResult.status === 'NOT_FOUND' && Number(withdraw.queryAttempts ?? 0) >= 9) {
            await this.finalizeWithdrawalFailed(withdraw.id, {
              errorCode: 'NOT_FOUND_MAX_ATTEMPTS',
              errorMessage: '支付宝查询多次未找到订单，强制退款',
              providerStatus: 'NOT_FOUND',
            });
          }
        } catch (err: any) {
          this.logger.error(`提现补偿查询异常: withdrawId=${withdraw.id}, error=${err?.message ?? err}`);
        }
      }
    } finally {
      await this.redisCoordinator.releaseLock(lockKey, lockOwner);
    }
  }

  private async createWithdrawTx(
    userId: string,
    input: WithdrawDto,
    idempotencyKey: string | undefined,
    rules: WithdrawRules,
  ) {
    return this.prisma.$transaction(async (tx: any) => {
      const amountCents = yuanToCents(input.amount);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayCount = await tx.withdrawRequest.count({
        where: {
          userId,
          createdAt: { gte: todayStart },
          status: { not: 'FAILED' as any },
        },
      });
      if (todayCount >= rules.withdrawDailyMaxCount) {
        throw new BadRequestException(`每日最多提现 ${rules.withdrawDailyMaxCount} 次`);
      }

      const cooldownAgo = new Date(Date.now() - rules.withdrawCooldownSeconds * 1000);
      const lastWithdraw = await tx.withdrawRequest.findFirst({
        where: {
          userId,
          createdAt: { gte: cooldownAgo },
          status: { not: 'FAILED' as any },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (lastWithdraw) {
        throw new BadRequestException(`冷却时间未到，请 ${rules.withdrawCooldownSeconds} 秒后重试`);
      }

      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const yearAgg = await tx.withdrawRequest.aggregate({
        where: {
          userId,
          createdAt: { gte: yearStart },
          status: { in: ['PROCESSING', 'PAID'] as any },
        },
        _sum: { amount: true },
      });
      const yearTotalCents = yuanToCents(yearAgg._sum.amount || 0);
      const yearMaxCents = yuanToCents(rules.withdrawYearlyMaxAmount);
      if (yearTotalCents + amountCents > yearMaxCents) {
        throw new BadRequestException(`年累计提现已达上限 ¥${rules.withdrawYearlyMaxAmount}`);
      }

      const split = await this.deductBalanceForWithdraw(tx, userId, amountCents);
      const taxCents = Math.floor(amountCents * rules.withdrawTaxRate);
      const providerFeeCents = yuanToCents(rules.withdrawProviderFeeAmount);
      const netCents = amountCents - taxCents - providerFeeCents;
      if (netCents <= 0) {
        throw new BadRequestException('提现到账金额必须大于 0');
      }

      const id = randomUUID();
      const outBizNo = `WD-${id}`;
      // 主账户记录在 WithdrawRequest.accountType（用于管理后台筛选展示），优先级 VIP > NORMAL > INDUSTRY
      const primaryAccountType =
        split.fromVipCents > 0 ? 'VIP_REWARD'
        : split.fromNormalCents > 0 ? 'NORMAL_REWARD'
        : 'INDUSTRY_FUND';
      const created = await tx.withdrawRequest.create({
        data: {
          id,
          userId,
          amount: centsToYuan(amountCents),
          channel: 'ALIPAY' as any,
          accountSnapshot: encryptJsonValue({
            account: input.alipayAccount,
            name: input.alipayName,
          }) as any,
          accountType: primaryAccountType,
          status: 'PROCESSING' as any,
          taxAmount: centsToYuan(taxCents),
          netAmount: centsToYuan(netCents),
          taxRate: rules.withdrawTaxRate,
          providerFeeAmount: centsToYuan(providerFeeCents),
          outBizNo,
          clientIdempotencyKey: idempotencyKey ?? null,
        },
      });

      await this.createWithdrawLedgers(tx, {
        split,
        userId,
        withdrawId: created.id,
        outBizNo,
      });

      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async createWithdrawLedgers(
    tx: any,
    params: {
      split: WithdrawSplit;
      userId: string;
      withdrawId: string;
      outBizNo: string;
    },
  ): Promise<void> {
    const groupId = `WG-${params.withdrawId}`;
    // role 计算：SOLE / PRIMARY / SECONDARY / TERTIARY
    const sourcesUsed = [
      params.split.fromVipCents > 0,
      params.split.fromNormalCents > 0,
      params.split.fromIndustryFundCents > 0,
    ].filter(Boolean).length;

    if (params.split.fromVipCents > 0 && params.split.vipAccountId) {
      await tx.rewardLedger.create({
        data: {
          accountId: params.split.vipAccountId,
          userId: params.userId,
          entryType: 'WITHDRAW' as any,
          amount: centsToYuan(params.split.fromVipCents),
          status: 'FROZEN' as any,
          refType: 'WITHDRAW',
          refId: params.withdrawId,
          meta: {
            scheme: 'POINTS_WITHDRAW',
            groupId,
            outBizNo: params.outBizNo,
            accountType: 'VIP_REWARD',
            role: sourcesUsed > 1 ? 'PRIMARY' : 'SOLE',
          },
        },
      });
    }

    if (params.split.fromNormalCents > 0 && params.split.normalAccountId) {
      await tx.rewardLedger.create({
        data: {
          accountId: params.split.normalAccountId,
          userId: params.userId,
          entryType: 'WITHDRAW' as any,
          amount: centsToYuan(params.split.fromNormalCents),
          status: 'FROZEN' as any,
          refType: 'WITHDRAW',
          refId: params.withdrawId,
          meta: {
            scheme: 'POINTS_WITHDRAW',
            groupId,
            outBizNo: params.outBizNo,
            accountType: 'NORMAL_REWARD',
            role: params.split.fromVipCents > 0 ? 'SECONDARY' : 'PRIMARY',
          },
        },
      });
    }

    if (params.split.fromIndustryFundCents > 0 && params.split.industryFundAccountId) {
      await tx.rewardLedger.create({
        data: {
          accountId: params.split.industryFundAccountId,
          userId: params.userId,
          entryType: 'WITHDRAW' as any,
          amount: centsToYuan(params.split.fromIndustryFundCents),
          status: 'FROZEN' as any,
          refType: 'WITHDRAW',
          refId: params.withdrawId,
          meta: {
            scheme: 'POINTS_WITHDRAW',
            groupId,
            outBizNo: params.outBizNo,
            accountType: 'INDUSTRY_FUND',
            role: 'TERTIARY',
          },
        },
      });
    }
  }

  private assertIdempotentRetryMatches(
    existing: any,
    userId: string,
    input: WithdrawDto,
    amountCents: number,
  ): void {
    const snapshot = this.readAccountSnapshot(existing.accountSnapshot);
    const sameUser = existing.userId === userId;
    const sameAmount = yuanToCents(existing.amount) === amountCents;
    const sameAccount = snapshot.account === input.alipayAccount;
    if (!sameUser || !sameAmount || !sameAccount) {
      throw new ConflictException('Idempotency-Key conflict: existing request differs');
    }
  }

  private readAccountSnapshot(snapshot: unknown): { account?: string; name?: string } {
    const decrypted = decryptJsonValue<any>(snapshot);
    if (decrypted && typeof decrypted === 'object' && !Array.isArray(decrypted)) {
      return {
        account: typeof decrypted.account === 'string' ? decrypted.account : undefined,
        name: typeof decrypted.name === 'string' ? decrypted.name : undefined,
      };
    }
    return {};
  }

  private mapWithdrawResult(withdraw: any, message: string): WithdrawResult {
    return {
      withdrawId: withdraw.id,
      grossAmount: withdraw.amount,
      taxAmount: withdraw.taxAmount,
      taxRate: withdraw.taxRate,
      netAmount: withdraw.netAmount,
      status: withdraw.status as WithdrawStatusResult,
      message,
    };
  }

  private isUniqueConstraintError(err: any): boolean {
    return err?.code === 'P2002';
  }

  private async createAdminYearlyAlertLogs(
    userId: string,
    yearlyTotal: number,
    yearlyLimit: number,
    content: string,
  ): Promise<void> {
    const admins = await (this.prisma.adminUser as any).findMany({
      where: { status: 'ACTIVE' as any },
      select: { id: true },
    });
    if (!admins.length) return;

    await (this.prisma.adminAuditLog as any).createMany({
      data: admins.map((admin: { id: string }) => ({
        adminUserId: admin.id,
        action: 'STATUS_CHANGE',
        module: 'bonus',
        targetType: 'User',
        targetId: userId,
        summary: '高额提现告警',
        after: {
          type: 'withdraw_yearly_alert',
          userId,
          yearlyTotal,
          yearlyLimit,
          percentage: yearlyLimit > 0 ? yearlyTotal / yearlyLimit : null,
          content,
        },
        isReversible: false,
      })),
    });
  }

  private resolvePaymentService(): TransferPaymentService {
    if (!this.paymentService) {
      this.paymentService = this.moduleRef.get(PaymentService, { strict: false }) as TransferPaymentService;
    }
    if (typeof this.paymentService?.initiateTransfer !== 'function') {
      throw new InternalServerErrorException('提现通道未就绪');
    }
    return this.paymentService;
  }

  private resolveAlipayService(): AlipayService {
    if (!this.alipayService) {
      this.alipayService = this.moduleRef.get(AlipayService, { strict: false });
    }
    if (typeof this.alipayService?.queryTransfer !== 'function') {
      throw new InternalServerErrorException('支付宝提现查询通道未就绪');
    }
    return this.alipayService;
  }
}
