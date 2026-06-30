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
import { NotificationService } from '../notification/notification.service';
import { AlipayService } from '../payment/alipay.service';
import { PaymentService } from '../payment/payment.service';
import { WithdrawDto } from './dto/withdraw.dto';
import type { WithdrawRules } from './dto/withdraw-rules.dto';
import { WithdrawRulesService } from './withdraw-rules.service';

type WithdrawStatusResult = 'PROCESSING' | 'PAID' | 'FAILED';
type WithdrawSource = 'REWARD' | 'GROUP_BUY_REBATE';
type WithdrawRequestSource = 'UNIFIED_POINTS' | 'GROUP_BUY_REBATE_LEGACY';
type AccountSnapshot = {
  account?: string;
  name?: string;
  source?: WithdrawRequestSource;
};

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
  source: WithdrawSource;
  fromVipCents: number;
  fromNormalCents: number;
  fromIndustryFundCents: number;
  fromGroupBuyRebateCents: number;
  vipAccountId?: string;
  normalAccountId?: string;
  industryFundAccountId?: string;
  groupBuyRebateAccountId?: string;
  groupBuyRebateBalanceBeforeCents?: number;
  groupBuyRebateBalanceAfterCents?: number;
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
    private notificationService: NotificationService,
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
    return this.requestWithdrawBySource(userId, input, idempotencyKey, 'REWARD');
  }

  async requestGroupBuyRebateWithdraw(
    userId: string,
    input: WithdrawDto,
    idempotencyKey?: string,
  ): Promise<WithdrawResult> {
    return this.requestWithdrawBySource(userId, input, idempotencyKey, 'GROUP_BUY_REBATE');
  }

  private async requestWithdrawBySource(
    userId: string,
    input: WithdrawDto,
    idempotencyKey: string | undefined,
    source: WithdrawSource,
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
        this.assertIdempotentRetryMatches(existing, userId, input, amountCents, source);
        return this.mapWithdrawResult(existing, '请求已处理');
      }
    }

    let created: any;
    try {
      created = await this.createWithdrawTx(userId, input, idempotencyKey, rules, source);
    } catch (err: any) {
      if (this.isUniqueConstraintError(err) && idempotencyKey) {
        const existing = await (this.prisma.withdrawRequest as any).findUnique({
          where: { clientIdempotencyKey: idempotencyKey },
        });
        if (existing) {
          this.assertIdempotentRetryMatches(existing, userId, input, amountCents, source);
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
        remark: this.getWithdrawRemark(source),
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
        message: this.mapWithdrawFailureMessage(transferResult.errorCode, transferResult.errorMessage),
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

  /**
   * 把渠道（支付宝）原始失败码翻译成给用户看的人话原因。
   * - 收款方相关（账号/姓名/未实名，用户可自行修正）：始终显示具体原因。
   * - 平台侧（余额/额度/付款方状态）：非生产显示具体便于排查，生产对用户软化。
   * 原始错误码始终记录在提现记录里供管理后台排查（不受此映射影响）。
   */
  private mapWithdrawFailureMessage(errorCode?: string, rawMessage?: string): string {
    const code = (errorCode || '').toUpperCase();
    const isProd = process.env.NODE_ENV === 'production';
    const soft = '提现暂时失败，款项已退回，请稍后重试';

    // 收款方相关（用户可自行修正）—— 始终具体
    if (code.startsWith('PAYEE') || code.includes('CARD_BIN')) {
      return '支付宝账号或实名姓名有误（或收款账号未实名），请核对后重试';
    }
    // 支付宝系统繁忙 —— 提示重试（对用户也合适）
    if (code === 'SYSTEM_ERROR') {
      return '支付宝系统繁忙，请稍后重试';
    }
    // 平台侧（余额/额度/付款方状态）—— 生产软化，测试具体
    if (code.includes('BALANCE') || code.includes('PAYCARD')) {
      return isProd ? soft : '商户账户余额不足 / 付款功能不可用，款项已退回';
    }
    if (code.includes('LIMIT')) {
      return isProd ? soft : '超出当日或单笔提现额度，款项已退回';
    }
    if (code.startsWith('PAYER')) {
      return isProd ? soft : `商户账户状态异常（${code}），款项已退回`;
    }
    // 未知 —— 软化；非生产带原始信息便于排查
    return isProd ? soft : `提现失败，款项已退回（${rawMessage || code || '未知原因'}）`;
  }

  async deductBalanceForWithdraw(
    tx: any,
    userId: string,
    amountCents: number,
  ): Promise<WithdrawSplit> {
    // 统一消费积分提现优先级：VIP_REWARD → NORMAL_REWARD → GROUP_BUY_REBATE → OWNER INDUSTRY_FUND
    const vip = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'VIP_REWARD' as any } },
    });
    const normal = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'NORMAL_REWARD' as any } },
    });
    const industry = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'INDUSTRY_FUND' as any } },
    });
    const groupBuyRebate = await tx.groupBuyRebateAccount.findUnique({ where: { userId } });
    const isSellerOwner = !!(await tx.companyStaff.findFirst({
      where: { userId, role: 'OWNER' as any, status: 'ACTIVE' as any },
      select: { id: true },
    }));

    const vipBalanceCents = vip ? yuanToCents(vip.balance) : 0;
    const normalBalanceCents = normal ? yuanToCents(normal.balance) : 0;
    const groupBuyRebateBalanceCents = groupBuyRebate ? yuanToCents(groupBuyRebate.balance) : 0;
    const industryBalanceCents = industry && isSellerOwner ? yuanToCents(industry.balance) : 0;
    if (vipBalanceCents + normalBalanceCents + groupBuyRebateBalanceCents + industryBalanceCents < amountCents) {
      throw new BadRequestException('余额不足');
    }

    const fromVipCents = Math.min(vipBalanceCents, amountCents);
    let remaining = amountCents - fromVipCents;
    const fromNormalCents = Math.min(normalBalanceCents, remaining);
    remaining -= fromNormalCents;
    const fromGroupBuyRebateCents = Math.min(groupBuyRebateBalanceCents, remaining);
    remaining -= fromGroupBuyRebateCents;
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

    if (fromGroupBuyRebateCents > 0 && groupBuyRebate) {
      const amount = centsToYuan(fromGroupBuyRebateCents);
      const cas = await tx.groupBuyRebateAccount.updateMany({
        where: { id: groupBuyRebate.id, balance: { gte: amount } },
        data: {
          balance: { decrement: amount },
          reserved: { increment: amount },
        },
      });
      if (cas.count !== 1) {
        throw new BadRequestException('团购返还余额扣减并发失败，请重试');
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
      source: 'REWARD',
      fromVipCents,
      fromNormalCents,
      fromIndustryFundCents,
      fromGroupBuyRebateCents,
      vipAccountId: vip?.id,
      normalAccountId: normal?.id,
      industryFundAccountId: isSellerOwner ? industry?.id : undefined,
      groupBuyRebateAccountId: groupBuyRebate?.id,
      groupBuyRebateBalanceBeforeCents: groupBuyRebateBalanceCents,
      groupBuyRebateBalanceAfterCents: groupBuyRebateBalanceCents - fromGroupBuyRebateCents,
    };
  }

  async deductGroupBuyRebateBalanceForWithdraw(
    tx: any,
    userId: string,
    amountCents: number,
  ): Promise<WithdrawSplit> {
    const account = await tx.groupBuyRebateAccount.findUnique({ where: { userId } });
    const balanceCents = account ? yuanToCents(account.balance) : 0;
    if (!account || balanceCents < amountCents) {
      throw new BadRequestException('团购返还余额不足');
    }

    const amount = centsToYuan(amountCents);
    const cas = await tx.groupBuyRebateAccount.updateMany({
      where: { id: account.id, balance: { gte: amount } },
      data: {
        balance: { decrement: amount },
        reserved: { increment: amount },
      },
    });
    if (cas.count !== 1) {
      throw new BadRequestException('团购返还余额扣减并发失败，请重试');
    }

    return {
      source: 'GROUP_BUY_REBATE',
      fromVipCents: 0,
      fromNormalCents: 0,
      fromIndustryFundCents: 0,
      fromGroupBuyRebateCents: amountCents,
      groupBuyRebateAccountId: account.id,
      groupBuyRebateBalanceBeforeCents: balanceCents,
      groupBuyRebateBalanceAfterCents: balanceCents - amountCents,
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
      const rewardLedgers = await tx.rewardLedger.findMany({
        where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' as any },
      });

      for (const ledger of rewardLedgers ?? []) {
        const release = await tx.rewardAccount.updateMany({
          where: { id: ledger.accountId, frozen: { gte: ledger.amount } },
          data: { frozen: { decrement: ledger.amount } },
        });
        if (release.count !== 1) {
          throw new InternalServerErrorException('提现冻结余额释放失败');
        }
      }

      if ((rewardLedgers ?? []).length > 0) {
        await tx.rewardLedger.updateMany({
          where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' as any },
          data: { status: 'WITHDRAWN' as any },
        });
      }

      const groupBuyLedgers = await tx.groupBuyRebateLedger.findMany({
        where: { refType: 'WITHDRAW', refId: withdrawId, status: 'RESERVED' as any },
      });

      for (const ledger of groupBuyLedgers ?? []) {
        const release = await tx.groupBuyRebateAccount.updateMany({
          where: { id: ledger.accountId, reserved: { gte: ledger.amount } },
          data: {
            reserved: { decrement: ledger.amount },
            withdrawn: { increment: ledger.amount },
          },
        });
        if (release.count !== 1) {
          throw new InternalServerErrorException('团购返还余额提现冻结释放失败');
        }
      }

      if ((groupBuyLedgers ?? []).length > 0) {
        await tx.groupBuyRebateLedger.updateMany({
          where: { refType: 'WITHDRAW', refId: withdrawId, status: 'RESERVED' as any },
          data: { status: 'COMPLETED' as any },
        });
      }

      return current;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (withdraw) {
      await this.notificationService.emit({
        eventType: 'withdraw.paid',
        aggregateType: 'withdrawRequest',
        aggregateId: withdraw.id,
        idempotencyKey: `withdraw:${withdraw.id}:paid`,
        actor: { kind: 'system' },
        payload: {
          withdrawId: withdraw.id,
          userId: withdraw.userId,
          amount: withdraw.amount,
          netAmount: withdraw.netAmount,
          taxAmount: withdraw.taxAmount,
        },
      });

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
      const rewardLedgers = await tx.rewardLedger.findMany({
        where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' as any },
      });

      for (const ledger of rewardLedgers ?? []) {
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

      if ((rewardLedgers ?? []).length > 0) {
        await tx.rewardLedger.updateMany({
          where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' as any },
          data: { status: 'VOIDED' as any, entryType: 'VOID' as any },
        });
      }

      const groupBuyLedgers = await tx.groupBuyRebateLedger.findMany({
        where: { refType: 'WITHDRAW', refId: withdrawId, status: 'RESERVED' as any },
      });

      for (const ledger of groupBuyLedgers ?? []) {
        const restore = await tx.groupBuyRebateAccount.updateMany({
          where: { id: ledger.accountId, reserved: { gte: ledger.amount } },
          data: {
            reserved: { decrement: ledger.amount },
            balance: { increment: ledger.amount },
          },
        });
        if (restore.count !== 1) {
          throw new InternalServerErrorException('团购返还余额提现失败回滚失败');
        }
      }

      if ((groupBuyLedgers ?? []).length > 0) {
        await tx.groupBuyRebateLedger.updateMany({
          where: { refType: 'WITHDRAW', refId: withdrawId, status: 'RESERVED' as any },
          data: { status: 'VOIDED' as any },
        });
      }

      return current;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (withdraw) {
      await this.notificationService.emit({
        eventType: 'withdraw.failed',
        aggregateType: 'withdrawRequest',
        aggregateId: withdraw.id,
        idempotencyKey: `withdraw:${withdraw.id}:failed`,
        actor: { kind: 'system' },
        payload: {
          withdrawId: withdraw.id,
          userId: withdraw.userId,
          amount: withdraw.amount,
          reason: 'PAYOUT_FAILED',
        },
      });
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
      await this.notificationService.emit({
        eventType: 'withdraw.processing',
        aggregateType: 'withdrawRequest',
        aggregateId: updated.id,
        idempotencyKey: `withdraw:${updated.id}:processing`,
        actor: { kind: 'system' },
        payload: {
          withdrawId: updated.id,
          userId: updated.userId,
          amount: updated.amount,
        },
      });
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
    const admins = await (this.prisma.adminUser as any).findMany({
      where: { status: 'ACTIVE' as any },
      select: { id: true },
    });
    await this.notificationService.emit({
      eventType: 'withdraw.yearlyAlert',
      aggregateType: 'withdrawRisk',
      aggregateId: `${userId}:${yearStart.getFullYear()}`,
      idempotencyKey: `withdraw:${userId}:${yearStart.getFullYear()}:yearly-alert`,
      actor: { kind: 'system' },
      payload: {
        userId,
        amount: total,
        yearlyLimit: rules.withdrawYearlyMaxAmount,
        adminUserIds: admins.map((admin: { id: string }) => admin.id),
      },
    });
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
    source: WithdrawSource,
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

      const split = source === 'GROUP_BUY_REBATE'
        ? await this.deductGroupBuyRebateBalanceForWithdraw(tx, userId, amountCents)
        : await this.deductBalanceForWithdraw(tx, userId, amountCents);
      const taxCents = Math.floor(amountCents * rules.withdrawTaxRate);
      const providerFeeCents = yuanToCents(rules.withdrawProviderFeeAmount);
      const netCents = amountCents - taxCents - providerFeeCents;
      if (netCents <= 0) {
        throw new BadRequestException('提现到账金额必须大于 0');
      }

      const id = randomUUID();
      const outBizNo = `WD-${id}`;
      // 主账户记录在 WithdrawRequest.accountType（用于管理后台筛选展示），优先级 VIP > NORMAL > GROUP_BUY > INDUSTRY
      const primaryAccountType = source === 'GROUP_BUY_REBATE'
        ? 'GROUP_BUY_REBATE'
        : split.fromVipCents > 0 ? 'VIP_REWARD'
          : split.fromNormalCents > 0 ? 'NORMAL_REWARD'
            : split.fromGroupBuyRebateCents > 0 ? 'GROUP_BUY_REBATE'
              : 'INDUSTRY_FUND';
      const requestSource: WithdrawRequestSource = source === 'GROUP_BUY_REBATE'
        ? 'GROUP_BUY_REBATE_LEGACY'
        : 'UNIFIED_POINTS';
      const created = await tx.withdrawRequest.create({
        data: {
          id,
          userId,
          amount: centsToYuan(amountCents),
          channel: 'ALIPAY' as any,
          accountSnapshot: encryptJsonValue({
            account: input.alipayAccount,
            name: input.alipayName,
            source: requestSource,
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
    if (params.split.source === 'GROUP_BUY_REBATE') {
      if (params.split.fromGroupBuyRebateCents <= 0 || !params.split.groupBuyRebateAccountId) {
        return;
      }
      await tx.groupBuyRebateLedger.create({
        data: {
          accountId: params.split.groupBuyRebateAccountId,
          userId: params.userId,
          type: 'WITHDRAW' as any,
          status: 'RESERVED' as any,
          amount: centsToYuan(params.split.fromGroupBuyRebateCents),
          balanceBefore: centsToYuan(params.split.groupBuyRebateBalanceBeforeCents ?? 0),
          balanceAfter: centsToYuan(params.split.groupBuyRebateBalanceAfterCents ?? 0),
          refType: 'WITHDRAW',
          refId: params.withdrawId,
          idempotencyKey: `GROUP_BUY_WITHDRAW:${params.withdrawId}`,
          meta: {
            scheme: 'GROUP_BUY_REBATE_WITHDRAW',
            groupId,
            outBizNo: params.outBizNo,
            accountType: 'GROUP_BUY_REBATE',
            role: 'SOLE',
          },
        },
      });
      return;
    }

    const usedSources = [
      params.split.fromVipCents > 0 ? 'VIP_REWARD' : null,
      params.split.fromNormalCents > 0 ? 'NORMAL_REWARD' : null,
      params.split.fromGroupBuyRebateCents > 0 ? 'GROUP_BUY_REBATE' : null,
      params.split.fromIndustryFundCents > 0 ? 'INDUSTRY_FUND' : null,
    ].filter(Boolean) as string[];
    const roleFor = (accountType: string) => {
      if (usedSources.length <= 1) return 'SOLE';
      const index = usedSources.indexOf(accountType);
      return ['PRIMARY', 'SECONDARY', 'TERTIARY', 'QUATERNARY'][index] ?? 'SECONDARY';
    };

    // role 计算：SOLE / PRIMARY / SECONDARY / TERTIARY / QUATERNARY
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
            role: roleFor('VIP_REWARD'),
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
            role: roleFor('NORMAL_REWARD'),
          },
        },
      });
    }

    if (params.split.fromGroupBuyRebateCents > 0 && params.split.groupBuyRebateAccountId) {
      await tx.groupBuyRebateLedger.create({
        data: {
          accountId: params.split.groupBuyRebateAccountId,
          userId: params.userId,
          type: 'WITHDRAW' as any,
          status: 'RESERVED' as any,
          amount: centsToYuan(params.split.fromGroupBuyRebateCents),
          balanceBefore: centsToYuan(params.split.groupBuyRebateBalanceBeforeCents ?? 0),
          balanceAfter: centsToYuan(params.split.groupBuyRebateBalanceAfterCents ?? 0),
          refType: 'WITHDRAW',
          refId: params.withdrawId,
          idempotencyKey: `POINTS_GROUP_BUY_WITHDRAW:${params.withdrawId}`,
          meta: {
            scheme: 'POINTS_WITHDRAW',
            groupId,
            outBizNo: params.outBizNo,
            accountType: 'GROUP_BUY_REBATE',
            role: roleFor('GROUP_BUY_REBATE'),
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
            role: roleFor('INDUSTRY_FUND'),
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
    source: WithdrawSource,
  ): void {
    const snapshot = this.readAccountSnapshot(existing.accountSnapshot);
    const sameUser = existing.userId === userId;
    const sameAmount = yuanToCents(existing.amount) === amountCents;
    const sameAccount = snapshot.account === input.alipayAccount;
    const sameName = snapshot.name === input.alipayName;
    const existingSource = this.resolveWithdrawSource(existing);
    const sameSource = existingSource === source;
    if (!sameUser || !sameAmount || !sameAccount || !sameName || !sameSource) {
      throw new ConflictException('Idempotency-Key conflict: existing request differs');
    }
  }

  private resolveWithdrawSource(withdraw: any): WithdrawSource {
    const snapshot = this.readAccountSnapshot(withdraw?.accountSnapshot);
    if (snapshot.source === 'UNIFIED_POINTS') {
      return 'REWARD';
    }
    if (snapshot.source === 'GROUP_BUY_REBATE_LEGACY') {
      return 'GROUP_BUY_REBATE';
    }
    return withdraw?.accountType === 'GROUP_BUY_REBATE' ? 'GROUP_BUY_REBATE' : 'REWARD';
  }

  private getWithdrawRemark(source: WithdrawSource): string {
    return source === 'GROUP_BUY_REBATE'
      ? '爱买买团购返还余额提现'
      : '爱买买消费积分提现';
  }

  private readAccountSnapshot(snapshot: unknown): AccountSnapshot {
    const decrypted = decryptJsonValue<any>(snapshot);
    if (decrypted && typeof decrypted === 'object' && !Array.isArray(decrypted)) {
      const source = decrypted.source === 'UNIFIED_POINTS' || decrypted.source === 'GROUP_BUY_REBATE_LEGACY'
        ? decrypted.source
        : undefined;
      return {
        account: typeof decrypted.account === 'string' ? decrypted.account : undefined,
        name: typeof decrypted.name === 'string' ? decrypted.name : undefined,
        source,
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
