import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
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
import { PLATFORM_USER_ID } from './engine/constants';
import { pendingQueueClawbackCents } from '../queue-reward/queue-reward-clawback';
import { assertActiveUserWriteBarrier } from '../../common/transactions/active-user-write-barrier';
import {
  WechatMerchantTransferNotify,
  WechatMerchantTransferCreateResult,
  WechatMerchantTransferQueryResult,
  WechatMerchantTransferService,
} from './wechat-merchant-transfer.service';

type WithdrawStatusResult = 'PROCESSING' | 'PAID' | 'FAILED';
type WithdrawSource = 'REWARD' | 'GROUP_BUY_REBATE';
type WithdrawRequestSource = 'UNIFIED_POINTS' | 'GROUP_BUY_REBATE_LEGACY';
type AccountSnapshot = {
  account?: string;
  name?: string;
  source?: WithdrawRequestSource;
  channel?: 'ALIPAY' | 'WECHAT';
  appId?: string;
  packageInfo?: string;
};

type WechatNotifyInboxStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'DEAD';

type WithdrawAuthContext = {
  sessionId?: string | null;
  authIdentityId?: string | null;
};

type WechatWithdrawIdentity = {
  authIdentityId: string;
  appId: string;
  openId: string;
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
  mchId?: string;
  appId?: string;
  package?: string;
};

export type WechatMiniappWithdrawPolicy = {
  grossSingleMin: number;
  grossSingleMax: number;
  netUserDailyMax: number;
  netPlatformDailyMax: number;
  taxRate: number;
  providerFeeAmount: number;
};

type WithdrawSplit = {
  source: WithdrawSource;
  fromVipCents: number;
  fromNormalCents: number;
  fromQueueRewardCents: number;
  fromIndustryFundCents: number;
  fromGroupBuyRebateCents: number;
  vipAccountId?: string;
  normalAccountId?: string;
  queueRewardAccountId?: string;
  industryFundAccountId?: string;
  groupBuyRebateAccountId?: string;
  groupBuyRebateBalanceBeforeCents?: number;
  groupBuyRebateBalanceAfterCents?: number;
};

const yuanToCents = (amount: number) => Math.round(amount * 100);
const centsToYuan = (cents: number) => Math.round(cents) / 100;
const WECHAT_CREATING_LEASE_MS = 2 * 60 * 1000;
const WECHAT_RETRY_ATTEMPTS = new Set([3, 6, 9]);
const WECHAT_CANCEL_AFTER_ATTEMPTS = 12;
const WECHAT_CANCEL_RETRY_ATTEMPTS = new Set([3, 6, 9, 12, 15, 18]);
const WECHAT_NOTIFY_MAX_ATTEMPTS = 8;
const WITHDRAW_RECONCILE_BATCH_SIZE = 20;
const WITHDRAW_RECONCILE_BACKOFF_MINUTES = [10, 20, 40, 80, 160, 240] as const;
// 微信支付商家转账（当前已选“佣金报酬”场景）的平台额度。申请金额仍是
// 统一钱包的 gross 金额；微信提现的 20% 税费在同一笔事务内计算后，以下
// 日额度按真正提交给微信的 net 金额裁决，不能由前端或并发请求绕过。
const WECHAT_MINIAPP_WITHDRAW_MAX_GROSS_CENTS = 20_000;
const WECHAT_MINIAPP_WITHDRAW_MIN_GROSS_CENTS = 10;
const WECHAT_TRANSFER_USER_DAILY_MAX_NET_CENTS = 200_000;
const WECHAT_TRANSFER_PLATFORM_DAILY_MAX_NET_CENTS = 5_000_000;
const CHINA_TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

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
    @Optional() private wechatTransferService?: WechatMerchantTransferService,
  ) {}

  onModuleInit() {
    this.paymentService = this.moduleRef.get(PaymentService, { strict: false }) as TransferPaymentService;
    this.alipayService = this.moduleRef.get(AlipayService, { strict: false });
  }

  async requestWithdraw(
    userId: string,
    input: WithdrawDto,
    idempotencyKey?: string,
    authContext?: WithdrawAuthContext,
  ): Promise<WithdrawResult> {
    return this.requestWithdrawBySource(
      userId,
      input,
      idempotencyKey,
      'REWARD',
      authContext,
    );
  }

  async requestGroupBuyRebateWithdraw(
    userId: string,
    input: WithdrawDto,
    idempotencyKey?: string,
    authContext?: WithdrawAuthContext,
  ): Promise<WithdrawResult> {
    return this.requestWithdrawBySource(
      userId,
      input,
      idempotencyKey,
      'GROUP_BUY_REBATE',
      authContext,
    );
  }

  /**
   * 小程序只读取当前有效规则，不能提现额度余额或任何内部资金来源。
   * 税率仍以提现创建时服务端再次读取的规则为准，前端仅用于同口径预估。
   */
  async getWechatMiniappWithdrawPolicy(): Promise<WechatMiniappWithdrawPolicy> {
    const rules = await this.rulesService.getRules();
    return {
      grossSingleMin: centsToYuan(this.minimumWechatGrossCents(rules)),
      grossSingleMax: centsToYuan(WECHAT_MINIAPP_WITHDRAW_MAX_GROSS_CENTS),
      netUserDailyMax: centsToYuan(WECHAT_TRANSFER_USER_DAILY_MAX_NET_CENTS),
      netPlatformDailyMax: centsToYuan(WECHAT_TRANSFER_PLATFORM_DAILY_MAX_NET_CENTS),
      taxRate: rules.withdrawTaxRate,
      providerFeeAmount: rules.withdrawProviderFeeAmount,
    };
  }

  /**
   * 恢复用户关闭的微信收款确认页。绝不新建转账：先验当前小程序
   * 会话与 OpenID，再查同一 outBillNo，只对仍可确认的原单返回
   * 已加密保存的 package_info。
   */
  async continueWechatWithdrawConfirmation(
    userId: string,
    withdrawId: string,
    authContext?: WithdrawAuthContext,
  ): Promise<WithdrawResult> {
    const identity = await this.resolveWechatWithdrawIdentity(
      this.prisma as any,
      userId,
      authContext,
    );
    const withdraw = await (this.prisma.withdrawRequest as any).findUnique({
      where: { id: withdrawId },
    });
    if (!withdraw || withdraw.userId !== userId || withdraw.channel !== 'WECHAT') {
      throw new BadRequestException('微信提现记录不存在');
    }
    if (withdraw.status !== 'PROCESSING') {
      return this.mapWithdrawResult(withdraw, withdraw.status === 'PAID'
        ? '提现已到账'
        : '该笔提现已结束');
    }

    const provider = this.resolveWechatTransferService();
    const snapshot = this.readAccountSnapshot(withdraw.accountSnapshot);
    if (
      snapshot.channel !== 'WECHAT'
      || snapshot.account !== identity.openId
      || snapshot.appId !== identity.appId
      || !withdraw.outBizNo
    ) {
      throw new UnauthorizedException('微信提现身份快照无效');
    }
    if (String(withdraw.providerStatus || '').startsWith('RECOVERY_CANCEL_')) {
      throw new ConflictException('该笔提现正在安全撤销，请稍后查看结果');
    }

    const query = await provider.queryTransfer(withdraw.outBizNo);
    if (query.outcome !== 'FOUND') {
      throw new ServiceUnavailableException('微信原单状态暂时无法确认，请稍后重试');
    }
    this.assertWechatQueryMatchesWithdraw(withdraw, query);

    if (query.state === 'SUCCESS') {
      await this.finalizeWithdrawalPaid(withdraw.id, {
        providerOrderId: query.transferBillNo,
        providerStatus: query.state,
      });
      return this.mapWithdrawResult(
        { ...withdraw, status: 'PAID', providerStatus: query.state },
        '提现已到账',
      );
    }
    if (query.state === 'FAIL' || query.state === 'CANCELLED') {
      await this.finalizeWithdrawalFailed(withdraw.id, {
        errorCode: query.state,
        errorMessage: query.failReason || '微信转账未成功',
        providerStatus: query.state,
        providerOrderId: query.transferBillNo,
      });
      return this.mapWithdrawResult(
        { ...withdraw, status: 'FAILED', providerStatus: query.state },
        '提现未成功，余额已退回',
      );
    }
    if (
      (query.state !== 'WAIT_USER_CONFIRM' && query.state !== 'TRANSFERING')
      || !snapshot.packageInfo
    ) {
      throw new ConflictException('微信原单当前暂不能重新确认，请稍后重试');
    }

    const persisted = await this.markWechatProcessingProviderInfo(withdraw, {
      state: query.state,
      transferBillNo: query.transferBillNo,
    });
    if (!persisted) {
      throw new ConflictException('提现状态已变化，请刷新后查看');
    }
    return this.mapWithdrawResult(withdraw, '请在微信中继续确认收款');
  }

  private async requestWithdrawBySource(
    userId: string,
    input: WithdrawDto,
    idempotencyKey: string | undefined,
    source: WithdrawSource,
    authContext?: WithdrawAuthContext,
  ): Promise<WithdrawResult> {
    const rules = await this.rulesService.getRules();
    const amountCents = yuanToCents(input.amount);
    const channel = input.channel === 'wechat' ? 'WECHAT' : 'ALIPAY';
    const wechatIdentity = channel === 'WECHAT'
      ? await this.resolveWechatWithdrawIdentity(
          this.prisma as any,
          userId,
          authContext,
        )
      : undefined;

    // 幂等重试必须能返回已创建的历史请求，不能因为后续额度策略变化把
    // 处理中请求变成“无从查询”的假失败；新请求才进入下面所有额度闸门。
    if (idempotencyKey) {
      const existing = await (this.prisma.withdrawRequest as any).findUnique({
        where: { clientIdempotencyKey: idempotencyKey },
      });
      if (existing) {
        this.assertIdempotentRetryMatches(
          existing,
          userId,
          input,
          amountCents,
          source,
          wechatIdentity,
        );
        return this.mapWithdrawResult(existing, '请求已处理');
      }
    }

    const minimumAmountCents = channel === 'WECHAT'
      ? this.minimumWechatGrossCents(rules)
      : yuanToCents(rules.withdrawMinAmount);
    if (amountCents < minimumAmountCents) {
      const minimumAmount = channel === 'WECHAT'
        ? centsToYuan(minimumAmountCents).toFixed(2)
        : rules.withdrawMinAmount;
      throw new BadRequestException(`单笔最低 ¥${minimumAmount}`);
    }
    if (channel === 'WECHAT') {
      if (amountCents > WECHAT_MINIAPP_WITHDRAW_MAX_GROSS_CENTS) {
        throw new BadRequestException('微信提现单笔最高 ¥200');
      }
      const expectedNetCents = amountCents
        - Math.floor(amountCents * rules.withdrawTaxRate)
        - yuanToCents(rules.withdrawProviderFeeAmount);
      if (expectedNetCents <= 0) {
        throw new BadRequestException('提现到账金额必须大于 0');
      }
      this.resolveWechatTransferServiceForCreate().assertTransferAmountSupported(expectedNetCents);
    } else if (amountCents > yuanToCents(rules.withdrawMaxAmount)) {
      // App / 支付宝继续使用后台可配置的全局单笔上限；
      // 小程序微信通道严格遵循商家转账产品的独立 ¥200 上限。
      throw new BadRequestException(`单笔最高 ¥${rules.withdrawMaxAmount}`);
    }

    let created: any;
    try {
      const MAX_CREATE_RETRIES = 3;
      for (let attempt = 1; attempt <= MAX_CREATE_RETRIES; attempt += 1) {
        try {
          created = await this.createWithdrawTx(
            userId,
            input,
            idempotencyKey,
            rules,
            source,
            authContext,
          );
          break;
        } catch (err: any) {
          const retryable = err instanceof Prisma.PrismaClientKnownRequestError
            && err.code === 'P2034'
            && attempt < MAX_CREATE_RETRIES;
          if (!retryable) throw err;
          await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
        }
      }
    } catch (err: any) {
      if (this.isUniqueConstraintError(err) && idempotencyKey) {
        const existing = await (this.prisma.withdrawRequest as any).findUnique({
          where: { clientIdempotencyKey: idempotencyKey },
        });
        if (existing) {
          this.assertIdempotentRetryMatches(
            existing,
            userId,
            input,
            amountCents,
            source,
            wechatIdentity,
          );
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

    if (channel === 'WECHAT') {
      return this.initiateWechatWithdrawal(created, grossNet);
    }

    let transferResult: TransferProviderResult;
    try {
      transferResult = await this.resolvePaymentService().initiateTransfer({
        channel: 'ALIPAY',
        amount: created.netAmount,
        outBizNo: created.outBizNo!,
        payeeAccount: input.alipayAccount!,
        payeeRealName: input.alipayName!,
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

  private async initiateWechatWithdrawal(
    created: any,
    grossNet: {
      grossAmount: number;
      taxAmount: number;
      taxRate: number;
      netAmount: number;
    },
  ): Promise<WithdrawResult> {
    const provider = this.resolveWechatTransferServiceForCreate();
    const snapshot = this.readAccountSnapshot(created.accountSnapshot);
    if (!snapshot.account || snapshot.appId !== provider.getMiniProgramAppId()) {
      throw new UnauthorizedException('微信提现身份快照无效');
    }

    const claim = await (this.prisma.withdrawRequest as any).updateMany({
      where: {
        id: created.id,
        status: 'PROCESSING' as any,
        providerStatus: 'READY',
      },
      data: { providerStatus: 'CREATING', providerStateUpdatedAt: new Date() },
    });
    if (claim.count !== 1) {
      const current = await (this.prisma.withdrawRequest as any).findUnique({
        where: { id: created.id },
      });
      return this.mapWithdrawResult(current ?? created, '微信提现处理中，请稍后查看');
    }
    created.providerStatus = 'CREATING';
    created.providerStateUpdatedAt = new Date();

    let transferResult;
    try {
      transferResult = await provider.createTransfer({
        outBillNo: created.outBizNo,
        openId: snapshot.account,
        amountFen: yuanToCents(created.netAmount),
      });
    } catch (error: any) {
      if (error instanceof ServiceUnavailableException) throw error;
      await this.markWechatProcessingProviderInfo(created, {
        state: 'UNKNOWN',
        errorCode: String(error?.code || 'PROVIDER_EXCEPTION'),
      });
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'PROCESSING',
        message: '微信提现结果确认中，请稍后查看',
      };
    }

    if (transferResult.outcome === 'REJECTED') {
      await this.finalizeWithdrawalFailed(created.id, {
        errorCode: transferResult.errorCode,
        errorMessage: transferResult.errorMessage,
        providerStatus: 'REJECTED',
      });
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'FAILED',
        message: this.mapWithdrawFailureMessage(
          transferResult.errorCode,
          transferResult.errorMessage,
        ),
      };
    }

    if (transferResult.outcome !== 'FOUND' || !transferResult.state) {
      await this.markWechatProcessingProviderInfo(created, {
        state: 'UNKNOWN',
        errorCode: transferResult.errorCode,
      });
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'PROCESSING',
        message: '微信提现结果确认中，请稍后查看',
      };
    }

    if (transferResult.state === 'SUCCESS') {
      await this.finalizeWithdrawalPaid(created.id, {
        providerOrderId: transferResult.transferBillNo,
        providerStatus: 'SUCCESS',
      });
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'PAID',
        message: `提现已到账 ¥${created.netAmount.toFixed(2)}`,
      };
    }

    if (transferResult.state === 'FAIL' || transferResult.state === 'CANCELLED') {
      await this.finalizeWithdrawalFailed(created.id, {
        errorCode: transferResult.state,
        errorMessage: '微信转账未成功',
        providerStatus: transferResult.state,
        providerOrderId: transferResult.transferBillNo,
      });
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'FAILED',
        message: '微信提现未成功，款项已退回',
      };
    }

    if (transferResult.state === 'WAIT_USER_CONFIRM' && !transferResult.packageInfo) {
      await this.recoverUnconfirmableWechatTransfer(created, {
        transferBillNo: transferResult.transferBillNo,
        reason: 'WAIT_USER_CONFIRM_PACKAGE_UNRECOVERABLE',
      });
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'PROCESSING',
        message: '微信提现正在安全恢复，请稍后重试',
      };
    }

    try {
      const persisted = await this.markWechatProcessingProviderInfo(created, {
        state: transferResult.state,
        transferBillNo: transferResult.transferBillNo,
        packageInfo: transferResult.packageInfo,
      });
      if (!persisted) {
        this.logger.warn(
          `微信提现创建结果被并发状态转换围栏拒绝: withdrawId=${created.id}`,
        );
        return {
          withdrawId: created.id,
          ...grossNet,
          status: 'PROCESSING',
          message: '微信提现处理中，请稍后查看',
        };
      }
    } catch (error: any) {
      // package_info 只在创建响应中返回。若无法持久化，绝不能把一次性参数直接交给客户端；
      // 先撤销原单并保持资金冻结，待查到 CANCELLED 后再幂等退款。
      await this.recoverUnconfirmableWechatTransfer(created, {
        transferBillNo: transferResult.transferBillNo,
        reason: 'PACKAGE_PERSIST_FAILED',
      });
      this.logger.error(
        `微信提现确认参数落库失败，已启动撤销恢复: withdrawId=${created.id} error=${error?.message || 'UNKNOWN'}`,
      );
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'PROCESSING',
        message: '微信提现正在安全恢复，请稍后重试',
      };
    }
    if (transferResult.state === 'WAIT_USER_CONFIRM' && transferResult.packageInfo) {
      return {
        withdrawId: created.id,
        ...grossNet,
        status: 'PROCESSING',
        message: '请在微信中确认收款',
        mchId: provider.getMerchantId(),
        appId: provider.getMiniProgramAppId(),
        package: transferResult.packageInfo,
      };
    }
    return {
      withdrawId: created.id,
      ...grossNet,
      status: 'PROCESSING',
      message: '微信提现处理中，请稍后查看',
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
    // 统一提现优先级：VIP → 普通树 → 全局队列 → 团购返还 → OWNER 产业基金
    const vip = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'VIP_REWARD' as any } },
    });
    const normal = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'NORMAL_REWARD' as any } },
    });
    const industry = await tx.rewardAccount.findUnique({
      where: { userId_type: { userId, type: 'INDUSTRY_FUND' as any } },
    });
    const queueReward = await tx.rewardAccount.findUnique({
      where: {
        userId_type: {
          userId,
          type: 'QUEUE_REWARD' as any,
        },
      },
    });
    const groupBuyRebate = await tx.groupBuyRebateAccount.findUnique({ where: { userId } });
    const isSellerOwner = !!(await tx.companyStaff.findFirst({
      where: { userId, role: 'OWNER' as any, status: 'ACTIVE' as any },
      select: { id: true },
    }));

    const vipBalanceCents = vip ? yuanToCents(vip.balance) : 0;
    const normalBalanceCents = normal ? yuanToCents(normal.balance) : 0;
    const pendingQueueClawbacks = queueReward
      ? await tx.rewardLedger.findMany({
          where: {
            accountId: queueReward.id,
            userId,
            entryType: 'VOID',
            status: 'RETURN_FROZEN',
          },
          select: { amount: true, meta: true },
        })
      : [];
    const pendingQueueClawbackTotalCents =
      pendingQueueClawbackCents(
        pendingQueueClawbacks ?? [],
      );
    // 已形成的队列追偿债务优先占用后续队列可用余额，禁止反复提现逃逸。
    const queueRewardBalanceCents = queueReward
      ? Math.max(
          0,
          yuanToCents(queueReward.balance) -
            pendingQueueClawbackTotalCents,
        )
      : 0;
    const groupBuyRebateBalanceCents = groupBuyRebate ? yuanToCents(groupBuyRebate.balance) : 0;
    const industryBalanceCents = industry && isSellerOwner ? yuanToCents(industry.balance) : 0;
    if (
      vipBalanceCents +
        normalBalanceCents +
        queueRewardBalanceCents +
        groupBuyRebateBalanceCents +
        industryBalanceCents <
      amountCents
    ) {
      throw new BadRequestException('余额不足');
    }

    const fromVipCents = Math.min(vipBalanceCents, amountCents);
    let remaining = amountCents - fromVipCents;
    const fromNormalCents = Math.min(normalBalanceCents, remaining);
    remaining -= fromNormalCents;
    const fromQueueRewardCents = Math.min(
      queueRewardBalanceCents,
      remaining,
    );
    remaining -= fromQueueRewardCents;
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

    if (fromQueueRewardCents > 0 && queueReward) {
      const amount = centsToYuan(fromQueueRewardCents);
      const cas = await tx.rewardAccount.updateMany({
        where: {
          id: queueReward.id,
          balance: { gte: amount },
        },
        data: {
          balance: { decrement: amount },
          frozen: { increment: amount },
        },
      });
      if (cas.count !== 1) {
        throw new BadRequestException(
          '排队红包余额扣减并发失败，请重试',
        );
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
      fromQueueRewardCents,
      fromIndustryFundCents,
      fromGroupBuyRebateCents,
      vipAccountId: vip?.id,
      normalAccountId: normal?.id,
      queueRewardAccountId: queueReward?.id,
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
      fromQueueRewardCents: 0,
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
      providerOrderId?: string;
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
          providerPayoutId: providerResult.providerOrderId,
        },
      });
      if (cas.count === 0) return null;

      const current = await tx.withdrawRequest.findUnique({ where: { id: withdrawId } });
      const rewardLedgers = await tx.rewardLedger.findMany({
        where: { refType: 'WITHDRAW', refId: withdrawId, status: 'FROZEN' as any },
        include: {
          account: {
            select: { type: true },
          },
        },
      });

      for (const ledger of rewardLedgers ?? []) {
        const restoredToBalanceCents =
          ledger.account?.type === 'QUEUE_REWARD'
            ? await this.settleQueueClawbacksFromFailedWithdrawal(
                tx,
                ledger,
                withdrawId,
              )
            : yuanToCents(ledger.amount);
        const restore = await tx.rewardAccount.updateMany({
          where: { id: ledger.accountId, frozen: { gte: ledger.amount } },
          data: {
            frozen: { decrement: ledger.amount },
            balance: {
              increment: centsToYuan(
                restoredToBalanceCents,
              ),
            },
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

  private async settleQueueClawbacksFromFailedWithdrawal(
    tx: any,
    withdrawalLedger: {
      accountId: string;
      userId: string;
      amount: number;
    },
    withdrawId: string,
  ): Promise<number> {
    let remainingCents = yuanToCents(withdrawalLedger.amount);
    const clawbacks = await tx.rewardLedger.findMany({
      where: {
        accountId: withdrawalLedger.accountId,
        userId: withdrawalLedger.userId,
        entryType: 'VOID',
        status: 'RETURN_FROZEN',
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const clawback of clawbacks ?? []) {
      if (remainingCents <= 0) break;
      const meta =
        clawback.meta &&
        typeof clawback.meta === 'object' &&
        !Array.isArray(clawback.meta)
          ? (clawback.meta as Record<string, any>)
          : {};
      if (meta.scheme !== 'GLOBAL_QUEUE_VOID') continue;
      const distributionId =
        typeof meta.originalDistributionId === 'string'
          ? meta.originalDistributionId
          : null;
      const pendingCents = yuanToCents(
        Number(meta.clawbackAmount ?? 0),
      );
      if (!distributionId || pendingCents <= 0) continue;

      const recoveredCents = Math.min(
        remainingCents,
        pendingCents,
      );
      const distribution =
        await tx.queueRewardDistribution.findUnique({
          where: { id: distributionId },
          select: {
            recoveredAmount: true,
            platformReturnedAmount: true,
            platformReturnRatio: true,
          },
        });
      if (!distribution) {
        throw new InternalServerErrorException(
          '队列提现失败追偿缺少原始分配记录',
        );
      }
      const ratio = this.readQueuePlatformReturnRatio(
        distribution.platformReturnRatio,
      );
      const previousRecoveredCents = yuanToCents(
        distribution.recoveredAmount,
      );
      const previousPlatformReturnedCents = yuanToCents(
        distribution.platformReturnedAmount,
      );
      const nextRecoveredCents =
        previousRecoveredCents + recoveredCents;
      const nextPlatformReturnedCents = Number(
        (BigInt(nextRecoveredCents) *
          BigInt(ratio.numerator)) /
          BigInt(ratio.denominator),
      );
      const platformDeltaCents =
        nextPlatformReturnedCents -
        previousPlatformReturnedCents;
      if (platformDeltaCents < 0) {
        throw new InternalServerErrorException(
          '队列提现失败追偿的平台回流金额异常',
        );
      }

      const distributionCas =
        await tx.queueRewardDistribution.updateMany({
          where: {
            id: distributionId,
            recoveredAmount: distribution.recoveredAmount,
            platformReturnedAmount:
              distribution.platformReturnedAmount,
          },
          data: {
            recoveredAmount:
              centsToYuan(nextRecoveredCents),
            platformReturnedAmount:
              centsToYuan(nextPlatformReturnedCents),
          },
        });
      if (distributionCas.count !== 1) {
        throw new InternalServerErrorException(
          '队列提现失败追偿发生并发变化',
        );
      }

      const nextPendingCents =
        pendingCents - recoveredCents;
      await tx.rewardLedger.update({
        where: { id: clawback.id },
        data: {
          status:
            nextPendingCents === 0
              ? 'VOIDED'
              : 'RETURN_FROZEN',
          meta: {
            ...meta,
            recoveredAmount: centsToYuan(
              yuanToCents(Number(meta.recoveredAmount ?? 0)) +
                recoveredCents,
            ),
            clawbackAmount: centsToYuan(nextPendingCents),
            clawbackStatus:
              nextPendingCents === 0
                ? 'CLAWBACK_RECOVERED'
                : 'CLAWBACK_PENDING',
            recoveredFromFailedWithdrawId: withdrawId,
          },
        },
      });

      if (platformDeltaCents > 0) {
        const platformAccount = await tx.rewardAccount.upsert({
          where: {
            userId_type: {
              userId: PLATFORM_USER_ID,
              type: 'PLATFORM_PROFIT',
            },
          },
          update: {},
          create: {
            userId: PLATFORM_USER_ID,
            type: 'PLATFORM_PROFIT',
          },
          select: { id: true },
        });
        const platformDelta =
          centsToYuan(platformDeltaCents);
        await tx.rewardLedger.create({
          data: {
            accountId: platformAccount.id,
            userId: PLATFORM_USER_ID,
            entryType: 'RELEASE',
            amount: platformDelta,
            status: 'AVAILABLE',
            refType: 'WITHDRAW',
            refId: withdrawId,
            idempotencyKey:
              `QUEUE_REWARD_WITHDRAW_FAILED_RECOVERY:` +
              `${withdrawId}:${distributionId}`,
            meta: {
              scheme:
                'GLOBAL_QUEUE_WITHDRAW_FAILED_RECOVERY',
              accountType: 'PLATFORM_PROFIT',
              originalDistributionId: distributionId,
              originalRecipientUserId:
                withdrawalLedger.userId,
              recoveredAmount:
                centsToYuan(recoveredCents),
              platformReturnedAmount: platformDelta,
              ratio,
              withdrawId,
            },
          },
        });
        await tx.rewardAccount.update({
          where: { id: platformAccount.id },
          data: {
            balance: { increment: platformDelta },
          },
        });
      }
      remainingCents -= recoveredCents;
    }

    return remainingCents;
  }

  private readQueuePlatformReturnRatio(
    raw: unknown,
  ): { numerator: number; denominator: number } {
    const value =
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const numerator = Number(value.numerator ?? 1);
    const denominator = Number(value.denominator ?? 1);
    if (
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator) ||
      numerator < 0 ||
      denominator <= 0 ||
      numerator > denominator
    ) {
      throw new InternalServerErrorException(
        '队列追偿平台回流比例不合法',
      );
    }
    return { numerator, denominator };
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

  private async markWechatProcessingProviderInfo(
    withdraw: any,
    providerResult: {
      state: string;
      transferBillNo?: string;
      packageInfo?: string;
      errorCode?: string;
    },
  ): Promise<boolean> {
    const snapshot = this.readAccountSnapshot(withdraw.accountSnapshot);
    const data: Record<string, unknown> = {
      providerStatus: providerResult.state,
      providerStateUpdatedAt: new Date(),
      providerErrorCode: providerResult.errorCode,
      accountSnapshot: encryptJsonValue({
        ...snapshot,
        channel: 'WECHAT',
        packageInfo: providerResult.packageInfo ?? snapshot.packageInfo,
      }) as any,
    };
    if (providerResult.transferBillNo) {
      data.providerPayoutId = providerResult.transferBillNo;
    }
    const where: Record<string, unknown> = {
      id: withdraw.id,
      status: 'PROCESSING' as any,
    };
    if (typeof withdraw.providerStatus === 'string' && withdraw.providerStatus) {
      where.providerStatus = withdraw.providerStatus;
    }
    const cas = await (this.prisma.withdrawRequest as any).updateMany({
      where,
      data,
    });
    if (cas.count !== 1) return false;
    withdraw.providerStatus = providerResult.state;
    withdraw.providerStateUpdatedAt = data.providerStateUpdatedAt;
    if (providerResult.transferBillNo) {
      withdraw.providerPayoutId = providerResult.transferBillNo;
    }
    withdraw.accountSnapshot = data.accountSnapshot;
    const updated = await (this.prisma.withdrawRequest as any).findUnique({
      where: { id: withdraw.id },
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
    return true;
  }

  private async recoverUnconfirmableWechatTransfer(
    withdraw: any,
    args: { transferBillNo?: string; reason: string },
  ): Promise<void> {
    // 必须先抢状态 owner 再发外部撤销。否则恢复者在 cancel 网络调用期间，
    // 原创建者仍可能 CREATING→WAIT 并把已被撤销的 package 返回客户端。
    try {
      const claimed = await this.markWechatProcessingProviderInfo(withdraw, {
        state: 'RECOVERY_CANCEL_CLAIMED',
        transferBillNo: args.transferBillNo,
        errorCode: args.reason,
      });
      if (!claimed) return;

      let cancel;
      try {
        cancel = await this.resolveWechatTransferService().cancelTransfer(withdraw.outBizNo);
      } catch (error: any) {
        cancel = { accepted: false, errorCode: String(error?.code || 'CANCEL_EXCEPTION') };
      }
      const cancelIdentityMatches = !args.transferBillNo
        || !cancel.transferBillNo
        || args.transferBillNo === cancel.transferBillNo;
      const cancelAccepted = cancel.accepted && cancelIdentityMatches;
      await this.markWechatProcessingProviderInfo(withdraw, {
        state: cancelAccepted ? 'RECOVERY_CANCEL_REQUESTED' : 'RECOVERY_CANCEL_PENDING',
        transferBillNo: args.transferBillNo,
        errorCode: cancelAccepted
          ? args.reason
          : `${args.reason}:${cancelIdentityMatches ? cancel.errorCode || 'CANCEL_UNKNOWN' : 'CANCEL_IDENTITY_MISMATCH'}`,
      });
    } catch (error: any) {
      this.logger.error(
        `微信提现撤销恢复状态落库失败: withdrawId=${withdraw.id} error=${error?.message || 'UNKNOWN'}`,
      );
    }
  }

  /**
   * 将已验签、已解密的回调放入持久化 inbox。eventId 冲突必须内容完全一致，
   * 防止同一微信事件号被替换为另一笔资金通知。
   */
  async enqueueWechatTransferNotify(notify: WechatMerchantTransferNotify): Promise<string> {
    const inbox = (this.prisma as any).wechatTransferNotifyInbox;
    const existing = await inbox.findUnique({ where: { eventId: notify.eventId } });
    if (existing) {
      const saved = decryptJsonValue<WechatMerchantTransferNotify>(existing.payload);
      if (JSON.stringify(saved) !== JSON.stringify(notify)) {
        throw new UnauthorizedException('微信提现通知事件号内容冲突');
      }
      return existing.eventId;
    }

    try {
      await inbox.create({
        data: {
          eventId: notify.eventId,
          outBillNo: notify.outBillNo,
          payload: encryptJsonValue(notify) as any,
          status: 'PENDING' satisfies WechatNotifyInboxStatus,
        },
      });
    } catch (error: any) {
      if (!this.isUniqueConstraintError(error)) throw error;
      const raced = await inbox.findUnique({ where: { eventId: notify.eventId } });
      const saved = raced
        ? decryptJsonValue<WechatMerchantTransferNotify>(raced.payload)
        : null;
      if (!raced || JSON.stringify(saved) !== JSON.stringify(notify)) {
        throw new UnauthorizedException('微信提现通知事件号内容冲突');
      }
    }
    return notify.eventId;
  }

  /** 单事件 CAS 消费；失败指数退避，超过上限转 DEAD 并通知管理员。 */
  async processWechatTransferNotifyInbox(eventId: string): Promise<void> {
    const inbox = (this.prisma as any).wechatTransferNotifyInbox;
    const now = new Date();
    const claim = await inbox.updateMany({
      where: { eventId, status: 'PENDING', nextAttemptAt: { lte: now } },
      data: {
        status: 'PROCESSING' satisfies WechatNotifyInboxStatus,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    if (claim.count !== 1) return;

    const row = await inbox.findUnique({ where: { eventId } });
    try {
      const notify = decryptJsonValue<WechatMerchantTransferNotify>(row?.payload);
      if (!notify || notify.eventId !== eventId || notify.outBillNo !== row?.outBillNo) {
        throw new UnauthorizedException('微信提现通知收件箱内容无效');
      }
      await this.handleWechatTransferNotify(notify);
      await inbox.updateMany({
        where: { eventId, status: 'PROCESSING' },
        data: {
          status: 'DONE' satisfies WechatNotifyInboxStatus,
          processedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error: any) {
      const attempts = Math.max(1, Number(row?.attempts ?? 1));
      const dead = attempts >= WECHAT_NOTIFY_MAX_ATTEMPTS;
      const delayMs = Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.min(attempts - 1, 7)));
      await inbox.updateMany({
        where: { eventId, status: 'PROCESSING' },
        data: {
          status: (dead ? 'DEAD' : 'PENDING') satisfies WechatNotifyInboxStatus,
          nextAttemptAt: dead ? now : new Date(now.getTime() + delayMs),
          deadAt: dead ? now : null,
          lastError: String(error?.message || 'UNKNOWN').slice(0, 500),
        },
      });
      if (dead) {
        await this.alertWechatNotifyDead(row, attempts, error);
      }
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryWechatTransferNotifyInbox(): Promise<void> {
    const inbox = (this.prisma as any).wechatTransferNotifyInbox;
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    await inbox.updateMany({
      where: { status: 'PROCESSING', updatedAt: { lt: staleBefore } },
      data: {
        status: 'PENDING' satisfies WechatNotifyInboxStatus,
        nextAttemptAt: new Date(),
      },
    });
    const rows = await inbox.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      select: { eventId: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: 20,
    });
    for (const row of rows) {
      try {
        await this.processWechatTransferNotifyInbox(row.eventId);
      } catch (error: any) {
        this.logger.error(
          `微信提现通知异步处理失败: eventId=${this.maskIdentifier(row.eventId)} error=${error?.message || 'UNKNOWN'}`,
        );
      }
    }
  }

  private async alertWechatNotifyDead(row: any, attempts: number, error: any): Promise<void> {
    const admins = await (this.prisma.adminUser as any).findMany({
      where: { status: 'ACTIVE' as any },
      select: { id: true },
    });
    await this.notificationService.emit({
      eventType: 'withdraw.wechatNotifyDead',
      aggregateType: 'wechatTransferNotifyInbox',
      aggregateId: row?.id || row?.eventId || 'unknown',
      idempotencyKey: `wechat-transfer-notify:${row?.eventId || 'unknown'}:dead`,
      actor: { kind: 'system' },
      payload: {
        outBillNo: row?.outBillNo,
        attempts,
        error: String(error?.message || 'UNKNOWN').slice(0, 200),
        adminUserIds: admins.map((admin: { id: string }) => admin.id),
      },
    });
  }

  /**
   * 商家转账通知不含 appid，因此必须用同一 outBillNo 主动查单后再收口。
   * 只有查询结果与本地身份快照及通知的全部资金字段一致，才允许改变状态。
   */
  async handleWechatTransferNotify(notify: WechatMerchantTransferNotify): Promise<void> {
    const withdraw = await (this.prisma.withdrawRequest as any).findUnique({
      where: { outBizNo: notify.outBillNo },
    });
    if (!withdraw || withdraw.channel !== 'WECHAT') {
      throw new UnauthorizedException('微信提现通知未匹配到可信订单');
    }

    const query = await this.resolveWechatTransferService().queryTransfer(notify.outBillNo);
    if (query.outcome !== 'FOUND') {
      throw new ServiceUnavailableException('微信提现通知暂无法完成原单查询');
    }
    this.assertWechatQueryMatchesWithdraw(withdraw, query, notify);

    if (query.state === 'SUCCESS') {
      await this.finalizeWithdrawalPaid(withdraw.id, {
        providerOrderId: query.transferBillNo,
        providerStatus: query.state,
      });
      return;
    }
    await this.finalizeWithdrawalFailed(withdraw.id, {
      errorCode: query.state,
      errorMessage: query.failReason || '微信转账未成功',
      providerStatus: query.state,
      providerOrderId: query.transferBillNo,
    });
  }

  private async reconcileWechatWithdrawal(withdraw: any): Promise<string> {
    const provider = this.resolveWechatTransferService();
    const query = await provider.queryTransfer(withdraw.outBizNo);
    const queryAttempts = Number(withdraw.queryAttempts ?? 0);
    const creatingLeaseActive = withdraw.providerStatus === 'CREATING'
      && withdraw.providerStateUpdatedAt instanceof Date
      && withdraw.providerStateUpdatedAt.getTime() > Date.now() - WECHAT_CREATING_LEASE_MS;

    if (query.outcome === 'FOUND') {
      this.assertWechatQueryMatchesWithdraw(withdraw, query);
      if (query.state === 'SUCCESS') {
        await this.finalizeWithdrawalPaid(withdraw.id, {
          providerOrderId: query.transferBillNo,
          providerStatus: query.state,
        });
        return 'PAID';
      }
      if (query.state === 'FAIL' || query.state === 'CANCELLED') {
        await this.finalizeWithdrawalFailed(withdraw.id, {
          errorCode: query.state,
          errorMessage: query.failReason || '微信转账未成功',
          providerStatus: query.state,
          providerOrderId: query.transferBillNo,
        });
        return 'FAILED';
      }
      // 创建请求的 owner 仍在租约内时，人工查单/Cron 只允许观察，不得撤销或覆盖
      // 一次性 package_info，避免“已撤销却仍向客户端返回确认参数”的竞态。
      if (creatingLeaseActive) return 'PROCESSING';
    } else if (creatingLeaseActive) {
      return 'PROCESSING';
    }

    if (
      query.outcome === 'NOT_FOUND'
      && (
        withdraw.providerStatus === 'READY'
        || withdraw.providerStatus === 'CREATING'
        || withdraw.providerStatus === 'UNKNOWN'
      )
    ) {
      // 本地已冻结但进程可能在调用微信前退出。只复用原 outBillNo 幂等发起，绝不换号。
      const snapshot = this.readAccountSnapshot(withdraw.accountSnapshot);
      if (!snapshot.account || snapshot.appId !== provider.getMiniProgramAppId()) {
        throw new UnauthorizedException('微信提现身份快照无效');
      }
      const created = await provider.createTransfer({
        outBillNo: withdraw.outBizNo,
        openId: snapshot.account,
        amountFen: yuanToCents(withdraw.netAmount),
      });
      const status = await this.applyWechatCreateRecoveryResult(withdraw, created);
      if (status === 'PROCESSING' && queryAttempts >= WECHAT_CANCEL_AFTER_ATTEMPTS) {
        await this.alertWechatWithdrawalStuck(withdraw, query.outcome, queryAttempts);
      }
      return status;
    }

    if (query.outcome !== 'FOUND') {
      // 未知/404 不能证明失败，必须保持冻结。
      if (queryAttempts >= WECHAT_CANCEL_AFTER_ATTEMPTS) {
        await this.alertWechatWithdrawalStuck(withdraw, query.outcome, queryAttempts);
      }
      return 'PROCESSING';
    }
    const snapshot = this.readAccountSnapshot(withdraw.accountSnapshot);
    if (String(withdraw.providerStatus || '').startsWith('RECOVERY_CANCEL_')) {
      if (
        withdraw.providerStatus !== 'RECOVERY_CANCEL_REQUESTED'
        && WECHAT_CANCEL_RETRY_ATTEMPTS.has(queryAttempts)
      ) {
        await this.recoverUnconfirmableWechatTransfer(withdraw, {
          transferBillNo: query.transferBillNo,
          reason: 'NON_TERMINAL_CANCEL_RETRY',
        });
      }
      if (queryAttempts >= WECHAT_CANCEL_AFTER_ATTEMPTS) {
        await this.alertWechatWithdrawalStuck(withdraw, query.state, queryAttempts);
      }
      return 'PROCESSING';
    }
    if (query.state === 'WAIT_USER_CONFIRM' && !snapshot.packageInfo) {
      await this.recoverUnconfirmableWechatTransfer(withdraw, {
        transferBillNo: query.transferBillNo,
        reason: 'WAIT_USER_CONFIRM_PACKAGE_UNAVAILABLE',
      });
      return 'PROCESSING';
    }

    if (
      (query.state === 'ACCEPTED' || query.state === 'PROCESSING')
      && WECHAT_RETRY_ATTEMPTS.has(queryAttempts)
    ) {
      // 微信官方允许使用完全相同的 outBillNo 原单重试；金额和 OpenID 均取加密快照，绝不换号。
      if (!snapshot.account || snapshot.appId !== provider.getMiniProgramAppId()) {
        throw new UnauthorizedException('微信提现身份快照无效');
      }
      const replay = await provider.createTransfer({
        outBillNo: withdraw.outBizNo,
        openId: snapshot.account,
        amountFen: yuanToCents(withdraw.netAmount),
      });
      return this.applyWechatCreateRecoveryResult(withdraw, replay);
    }

    if (
      (query.state === 'ACCEPTED' || query.state === 'PROCESSING')
      && queryAttempts >= WECHAT_CANCEL_AFTER_ATTEMPTS
    ) {
      // 限次原单重试仍无终态后，发起同一原单撤销；只有后续签名查询为 CANCELLED 才退款。
      await this.recoverUnconfirmableWechatTransfer(withdraw, {
        transferBillNo: query.transferBillNo,
        reason: 'NON_TERMINAL_MAX_ATTEMPTS',
      });
      await this.alertWechatWithdrawalStuck(withdraw, query.state, queryAttempts);
      return 'PROCESSING';
    }

    await this.markWechatProcessingProviderInfo(withdraw, {
      state: query.state,
      transferBillNo: query.transferBillNo,
    });
    return 'PROCESSING';
  }

  private async applyWechatCreateRecoveryResult(
    withdraw: any,
    created: WechatMerchantTransferCreateResult,
  ): Promise<string> {
    if (created.outcome === 'REJECTED') {
      await this.finalizeWithdrawalFailed(withdraw.id, {
        errorCode: created.errorCode,
        errorMessage: created.errorMessage,
        providerStatus: 'REJECTED',
      });
      return 'FAILED';
    }
    if (created.outcome !== 'FOUND' || !created.state) {
      await this.markWechatProcessingProviderInfo(withdraw, {
        state: 'UNKNOWN',
        errorCode: created.errorCode,
      });
      return 'PROCESSING';
    }
    if (created.state === 'SUCCESS') {
      await this.finalizeWithdrawalPaid(withdraw.id, {
        providerOrderId: created.transferBillNo,
        providerStatus: created.state,
      });
      return 'PAID';
    }
    if (created.state === 'FAIL' || created.state === 'CANCELLED') {
      await this.finalizeWithdrawalFailed(withdraw.id, {
        errorCode: created.state,
        errorMessage: '微信转账未成功',
        providerStatus: created.state,
        providerOrderId: created.transferBillNo,
      });
      return 'FAILED';
    }
    if (created.state === 'WAIT_USER_CONFIRM' && !created.packageInfo) {
      await this.recoverUnconfirmableWechatTransfer(withdraw, {
        transferBillNo: created.transferBillNo,
        reason: 'RECOVERED_CREATE_PACKAGE_UNAVAILABLE',
      });
      return 'PROCESSING';
    }
    await this.markWechatProcessingProviderInfo(withdraw, {
      state: created.state,
      transferBillNo: created.transferBillNo,
      packageInfo: created.packageInfo,
    });
    return 'PROCESSING';
  }

  private async alertWechatWithdrawalStuck(
    withdraw: any,
    providerState: string,
    attempts: number,
  ): Promise<void> {
    const admins = await (this.prisma.adminUser as any).findMany({
      where: { status: 'ACTIVE' as any },
      select: { id: true },
    });
    await this.notificationService.emit({
      eventType: 'withdraw.wechatStuck',
      aggregateType: 'withdrawRequest',
      aggregateId: withdraw.id,
      idempotencyKey: `withdraw:${withdraw.id}:wechat-stuck`,
      actor: { kind: 'system' },
      payload: {
        withdrawId: withdraw.id,
        userId: withdraw.userId,
        providerState,
        attempts,
        adminUserIds: admins.map((admin: { id: string }) => admin.id),
      },
    });
  }

  async manualReconcileWithdrawal(withdrawId: string): Promise<{
    status: string;
    channel: string;
    providerStatus?: string;
  }> {
    const withdraw = await (this.prisma.withdrawRequest as any).findUnique({
      where: { id: withdrawId },
    });
    if (!withdraw) throw new BadRequestException('提现记录不存在');
    if (withdraw.status !== 'PROCESSING') {
      return { status: withdraw.status, channel: withdraw.channel, providerStatus: withdraw.providerStatus };
    }
    const nextAttempt = Number(withdraw.queryAttempts ?? 0) + 1;
    const queriedAt = new Date();
    // 人工查单与 Cron 共用 lastQueriedAt 作为轻量租约版本。先 CAS 抢占再访问
    // 支付渠道，避免两者同时重放/撤销同一笔转账。
    const claimed = await (this.prisma.withdrawRequest as any).updateMany({
      where: {
        id: withdraw.id,
        status: 'PROCESSING' as any,
        lastQueriedAt: withdraw.lastQueriedAt ?? null,
      },
      data: {
        lastQueriedAt: queriedAt,
        nextReconcileAt: new Date(
          queriedAt.getTime() + this.withdrawReconcileDelayMs(nextAttempt),
        ),
        queryAttempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      const current = await (this.prisma.withdrawRequest as any).findUnique({
        where: { id: withdraw.id },
      });
      if (!current) throw new BadRequestException('提现记录不存在');
      if (current.status !== 'PROCESSING') {
        return {
          status: current.status,
          channel: current.channel,
          providerStatus: current.providerStatus,
        };
      }
      throw new ConflictException('提现查单正在处理中，请稍后重试');
    }
    withdraw.queryAttempts = nextAttempt;
    withdraw.lastQueriedAt = queriedAt;
    if (withdraw.channel === 'WECHAT') {
      const status = await this.reconcileWechatWithdrawal(withdraw);
      return { status, channel: 'WECHAT' };
    }
    if (withdraw.channel !== 'ALIPAY') {
      this.logger.error(`未知提现渠道，拒绝人工查单: withdrawId=${withdraw.id} channel=${withdraw.channel}`);
      throw new BadRequestException('该提现渠道暂不支持自动查单');
    }
    const query = await this.resolveAlipayService().queryTransfer({ outBizNo: withdraw.outBizNo });
    if (query.status === 'SUCCESS') {
      this.assertAlipayQueryMatchesWithdraw(withdraw, query);
      await this.finalizeWithdrawalPaid(withdraw.id, {
        providerOrderId: query.orderId,
        providerFundOrderId: query.payFundOrderId,
        providerStatus: 'SUCCESS',
      });
      return { status: 'PAID', channel: 'ALIPAY', providerStatus: query.status };
    }
    if (query.status === 'FAIL') {
      this.assertAlipayQueryMatchesWithdraw(withdraw, query);
      await this.finalizeWithdrawalFailed(withdraw.id, {
        errorCode: query.errorCode,
        errorMessage: query.errorMessage,
        providerStatus: 'FAIL',
        providerOrderId: query.orderId,
      });
      return { status: 'FAILED', channel: 'ALIPAY', providerStatus: query.status };
    }
    return { status: 'PROCESSING', channel: 'ALIPAY', providerStatus: query.status };
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
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const candidates = await (this.prisma.withdrawRequest as any).findMany({
        where: {
          deletedAt: null,
          status: 'PROCESSING' as any,
          createdAt: { lte: fiveMinAgo },
          outBizNo: { not: null },
          OR: [
            { nextReconcileAt: null },
            { nextReconcileAt: { lte: now } },
          ],
        },
        select: {
          id: true,
          userId: true,
          outBizNo: true,
          queryAttempts: true,
          channel: true,
          netAmount: true,
          accountSnapshot: true,
          providerPayoutId: true,
          providerStatus: true,
          providerStateUpdatedAt: true,
          nextReconcileAt: true,
        },
        orderBy: [
          { nextReconcileAt: { sort: 'asc', nulls: 'first' } },
          { createdAt: 'asc' },
        ],
        take: WITHDRAW_RECONCILE_BATCH_SIZE,
      });
      if (candidates.length === 0) return;

      for (const withdraw of candidates) {
        const nextAttempt = Number(withdraw.queryAttempts ?? 0) + 1;
        const claimedAt = new Date();
        const nextReconcileAt = new Date(
          claimedAt.getTime() + this.withdrawReconcileDelayMs(nextAttempt),
        );
        const claimed = await (this.prisma.withdrawRequest as any).updateMany({
          where: {
            id: withdraw.id,
            status: 'PROCESSING' as any,
            OR: [
              { nextReconcileAt: null },
              { nextReconcileAt: { lte: claimedAt } },
            ],
          },
          data: {
            lastQueriedAt: claimedAt,
            nextReconcileAt,
            queryAttempts: { increment: 1 },
          },
        });
        if (claimed.count !== 1) continue;
        withdraw.queryAttempts = nextAttempt;
        withdraw.nextReconcileAt = nextReconcileAt;

        try {
          if (withdraw.channel === 'WECHAT') {
            await this.reconcileWechatWithdrawal(withdraw);
            continue;
          }

          if (withdraw.channel !== 'ALIPAY') {
            this.logger.error(
              `未知提现渠道，补偿任务跳过: withdrawId=${withdraw.id} channel=${withdraw.channel}`,
            );
            continue;
          }

          const alipayService = this.resolveAlipayService();
          const queryResult = await alipayService.queryTransfer({ outBizNo: withdraw.outBizNo });

          if (queryResult.status === 'SUCCESS') {
            this.assertAlipayQueryMatchesWithdraw(withdraw, queryResult);
            await this.finalizeWithdrawalPaid(withdraw.id, {
              providerOrderId: queryResult.orderId,
              providerFundOrderId: queryResult.payFundOrderId,
              providerStatus: 'SUCCESS',
            });
          } else if (queryResult.status === 'FAIL') {
            this.assertAlipayQueryMatchesWithdraw(withdraw, queryResult);
            await this.finalizeWithdrawalFailed(withdraw.id, {
              errorCode: queryResult.errorCode,
              errorMessage: queryResult.errorMessage,
              providerStatus: 'FAIL',
              providerOrderId: queryResult.orderId,
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

  private withdrawReconcileDelayMs(attempt: number): number {
    const index = Math.min(
      Math.max(1, Math.trunc(attempt)) - 1,
      WITHDRAW_RECONCILE_BACKOFF_MINUTES.length - 1,
    );
    return WITHDRAW_RECONCILE_BACKOFF_MINUTES[index] * 60 * 1000;
  }

  private async createWithdrawTx(
    userId: string,
    input: WithdrawDto,
    idempotencyKey: string | undefined,
    rules: WithdrawRules,
    source: WithdrawSource,
    authContext?: WithdrawAuthContext,
  ) {
    return this.prisma.$transaction(async (tx: any) => {
      await assertActiveUserWriteBarrier(tx, userId);
      const amountCents = yuanToCents(input.amount);
      const channel = input.channel === 'wechat' ? 'WECHAT' : 'ALIPAY';
      const wechatIdentity = channel === 'WECHAT'
        ? await this.resolveWechatWithdrawIdentity(tx, userId, authContext)
        : undefined;
      const now = new Date();
      // Keep the pre-existing shared wallet's daily-count behaviour unchanged.
      // The WeChat transfer-specific amount caps below deliberately use China
      // natural days, as required by the provider, without changing Alipay/App.
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      // 微信小程序通道受微信按金额的日额度管理；若沿用 App/支付宝的“每天
      // 3 笔”通用限制，用户不可能触及微信承诺的 ¥2,000 单用户日额度，且
      // 不能得到统一的“请明日再提”提示。其他通道仍保持既有次数规则。
      if (channel !== 'WECHAT') {
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
      }

      // 微信原单在终态前可能仍等待用户确认或由平台异步处理中。
      // 同一用户只能保留一笔 PROCESSING 微信提现；否则用户关闭确认页后，
      // 绕过前端冷却即可再次冻结余额并生成第二个 out_bill_no，产生重复出款风险。
      // assertActiveUserWriteBarrier 已对当前用户加事务级写屏障，因此该检查与
      // 后续创建在并发请求下保持串行。
      if (channel === 'WECHAT') {
        const existingProcessingWechat = await tx.withdrawRequest.findFirst({
          where: {
            userId,
            channel: 'WECHAT' as any,
            status: 'PROCESSING' as any,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existingProcessingWechat) {
          throw new ConflictException('上一笔微信提现仍在处理中，请先完成确认或稍后查看结果');
        }
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

      const taxCents = Math.floor(amountCents * rules.withdrawTaxRate);
      const providerFeeCents = yuanToCents(rules.withdrawProviderFeeAmount);
      const netCents = amountCents - taxCents - providerFeeCents;
      if (netCents <= 0) {
        throw new BadRequestException('提现到账金额必须大于 0');
      }
      if (channel === 'WECHAT') {
        await this.assertWechatTransferDailyLimits(tx, {
          userId,
          now,
          requestedNetCents: netCents,
        });
      }
      const split = source === 'GROUP_BUY_REBATE'
        ? await this.deductGroupBuyRebateBalanceForWithdraw(tx, userId, amountCents)
        : await this.deductBalanceForWithdraw(tx, userId, amountCents);

      const id = randomUUID();
      // 微信 out_bill_no 只允许数字/字母且最长 32 位。
      const outBizNo = channel === 'WECHAT'
        ? `WX${id.replace(/-/g, '').slice(0, 30)}`
        : `WD-${id}`;
      // 主账户记录在 WithdrawRequest.accountType（用于管理后台筛选展示），优先级 VIP > NORMAL > GROUP_BUY > INDUSTRY
      const primaryAccountType = source === 'GROUP_BUY_REBATE'
        ? 'GROUP_BUY_REBATE'
        : split.fromVipCents > 0 ? 'VIP_REWARD'
          : split.fromNormalCents > 0 ? 'NORMAL_REWARD'
            : split.fromQueueRewardCents > 0
              ? 'QUEUE_REWARD'
              : split.fromGroupBuyRebateCents > 0
                ? 'GROUP_BUY_REBATE'
                : 'INDUSTRY_FUND';
      const requestSource: WithdrawRequestSource = source === 'GROUP_BUY_REBATE'
        ? 'GROUP_BUY_REBATE_LEGACY'
        : 'UNIFIED_POINTS';
      const created = await tx.withdrawRequest.create({
        data: {
          id,
          userId,
          amount: centsToYuan(amountCents),
          channel: channel as any,
          accountSnapshot: encryptJsonValue(channel === 'WECHAT'
            ? {
                account: wechatIdentity!.openId,
                source: requestSource,
                channel: 'WECHAT',
                appId: wechatIdentity!.appId,
              }
            : {
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
          providerStatus: channel === 'WECHAT' ? 'READY' : null,
          providerStateUpdatedAt: channel === 'WECHAT' ? new Date() : null,
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

  /**
   * 商家转账额度在微信受理原单时即锁定，因此按原单发起日（createdAt）的
   * 中国自然日归集 PROCESSING/PAID；跨零点后才成功的旧单仍属于原发起日，
   * 不能迁移到成功日重复占额。先拿全平台日锁，再在同一 Serializable 事务
   * 内汇总和创建请求，避免并发共同突破 ¥50,000；用户锁已先取得，锁序固定。
   */
  private async assertWechatTransferDailyLimits(
    tx: any,
    params: { userId: string; now: Date; requestedNetCents: number },
  ): Promise<void> {
    const dayStart = this.startOfChinaDay(params.now);
    const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const businessDate = this.chinaDateKey(params.now);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`WECHAT_TRANSFER_DAILY:${businessDate}`}))`;

    const dailyWhere = {
      channel: 'WECHAT' as any,
      status: { in: ['PROCESSING', 'PAID'] as any },
      createdAt: { gte: dayStart, lt: nextDayStart },
    };
    const userAggregate = await tx.withdrawRequest.aggregate({
      where: { ...dailyWhere, userId: params.userId },
      _sum: { netAmount: true },
    });
    const userTransferredCents = yuanToCents(userAggregate._sum.netAmount || 0);
    if (userTransferredCents + params.requestedNetCents > WECHAT_TRANSFER_USER_DAILY_MAX_NET_CENTS) {
      throw new BadRequestException('今日微信提现额度已用完，请明日再提');
    }

    const platformAggregate = await tx.withdrawRequest.aggregate({
      where: dailyWhere,
      _sum: { netAmount: true },
    });
    const platformTransferredCents = yuanToCents(platformAggregate._sum.netAmount || 0);
    if (platformTransferredCents + params.requestedNetCents > WECHAT_TRANSFER_PLATFORM_DAILY_MAX_NET_CENTS) {
      throw new BadRequestException('今日微信提现额度已满，请明日再提');
    }
  }

  private startOfChinaDay(now: Date): Date {
    const chinaNow = new Date(now.getTime() + CHINA_TIME_ZONE_OFFSET_MS);
    return new Date(Date.UTC(
      chinaNow.getUTCFullYear(),
      chinaNow.getUTCMonth(),
      chinaNow.getUTCDate(),
    ) - CHINA_TIME_ZONE_OFFSET_MS);
  }

  private chinaDateKey(now: Date): string {
    return new Date(now.getTime() + CHINA_TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10);
  }

  /**
   * 微信限制的是实际向用户发起的转账金额（至少 ¥0.10），而用户输入的是
   * 税前申请金额。以分为单位逐分计算，避免 ¥0.10 经 20% 预扣后只发出
   * ¥0.08 的无效请求；当前 20% 且无通道费时的最低申请额为 ¥0.12。
   */
  private minimumWechatGrossCents(rules: { withdrawTaxRate: number; withdrawProviderFeeAmount: number }): number {
    const providerFeeCents = yuanToCents(rules.withdrawProviderFeeAmount);
    for (let grossCents = WECHAT_MINIAPP_WITHDRAW_MIN_GROSS_CENTS;
      grossCents <= WECHAT_MINIAPP_WITHDRAW_MAX_GROSS_CENTS;
      grossCents += 1) {
      const netCents = grossCents - Math.floor(grossCents * rules.withdrawTaxRate) - providerFeeCents;
      if (netCents >= WECHAT_MINIAPP_WITHDRAW_MIN_GROSS_CENTS) return grossCents;
    }
    throw new ServiceUnavailableException('当前微信提现税费配置不支持微信最低转账金额');
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
      params.split.fromQueueRewardCents > 0
        ? 'QUEUE_REWARD'
        : null,
      params.split.fromGroupBuyRebateCents > 0 ? 'GROUP_BUY_REBATE' : null,
      params.split.fromIndustryFundCents > 0 ? 'INDUSTRY_FUND' : null,
    ].filter(Boolean) as string[];
    const roleFor = (accountType: string) => {
      if (usedSources.length <= 1) return 'SOLE';
      const index = usedSources.indexOf(accountType);
      return [
        'PRIMARY',
        'SECONDARY',
        'TERTIARY',
        'QUATERNARY',
        'QUINARY',
      ][index] ?? 'SECONDARY';
    };

    // role 计算：SOLE / PRIMARY / SECONDARY / TERTIARY / QUATERNARY / QUINARY
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

    if (
      params.split.fromQueueRewardCents > 0 &&
      params.split.queueRewardAccountId
    ) {
      await tx.rewardLedger.create({
        data: {
          accountId: params.split.queueRewardAccountId,
          userId: params.userId,
          entryType: 'WITHDRAW' as any,
          amount: centsToYuan(
            params.split.fromQueueRewardCents,
          ),
          status: 'FROZEN' as any,
          refType: 'WITHDRAW',
          refId: params.withdrawId,
          meta: {
            scheme: 'POINTS_WITHDRAW',
            groupId,
            outBizNo: params.outBizNo,
            accountType: 'QUEUE_REWARD',
            role: roleFor('QUEUE_REWARD'),
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
    wechatIdentity?: WechatWithdrawIdentity,
  ): void {
    const snapshot = this.readAccountSnapshot(existing.accountSnapshot);
    const inputChannel = input.channel === 'wechat' ? 'WECHAT' : 'ALIPAY';
    const existingChannel = existing.channel === 'WECHAT' || snapshot.channel === 'WECHAT'
      ? 'WECHAT'
      : 'ALIPAY';
    const sameUser = existing.userId === userId;
    const sameAmount = yuanToCents(existing.amount) === amountCents;
    const sameChannel = inputChannel === existingChannel;
    const sameAccount = inputChannel === 'WECHAT'
      ? Boolean(
          wechatIdentity
          && snapshot.account === wechatIdentity.openId
          && snapshot.appId === wechatIdentity.appId,
        )
      : snapshot.account === input.alipayAccount;
    const sameName = inputChannel === 'WECHAT' || snapshot.name === input.alipayName;
    const existingSource = this.resolveWithdrawSource(existing);
    const sameSource = existingSource === source;
    if (!sameUser || !sameAmount || !sameChannel || !sameAccount || !sameName || !sameSource) {
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
        channel: decrypted.channel === 'WECHAT' || decrypted.channel === 'ALIPAY'
          ? decrypted.channel
          : undefined,
        appId: typeof decrypted.appId === 'string' ? decrypted.appId : undefined,
        packageInfo: typeof decrypted.packageInfo === 'string'
          ? decrypted.packageInfo
          : undefined,
      };
    }
    return {};
  }

  private mapWithdrawResult(withdraw: any, message: string): WithdrawResult {
    const result: WithdrawResult = {
      withdrawId: withdraw.id,
      grossAmount: withdraw.amount,
      taxAmount: withdraw.taxAmount,
      taxRate: withdraw.taxRate,
      netAmount: withdraw.netAmount,
      status: withdraw.status as WithdrawStatusResult,
      message,
    };
    const snapshot = this.readAccountSnapshot(withdraw.accountSnapshot);
    if (
      withdraw.status === 'PROCESSING'
      && (withdraw.providerStatus === 'WAIT_USER_CONFIRM' || withdraw.providerStatus === 'TRANSFERING')
      && snapshot.channel === 'WECHAT'
      && snapshot.packageInfo
      && this.wechatTransferService?.isSettlementAvailable()
    ) {
      result.mchId = this.wechatTransferService.getMerchantId();
      result.appId = this.wechatTransferService.getMiniProgramAppId();
      result.package = snapshot.packageInfo;
    }
    return result;
  }

  private async resolveWechatWithdrawIdentity(
    client: any,
    userId: string,
    authContext?: WithdrawAuthContext,
  ): Promise<WechatWithdrawIdentity> {
    const provider = this.resolveWechatTransferService();
    const appId = provider.getMiniProgramAppId();
    if (!authContext?.sessionId || !authContext.authIdentityId) {
      throw new UnauthorizedException('当前会话不是可用的微信小程序登录');
    }
    const now = new Date();
    const session = await client.session.findFirst({
      where: {
        id: authContext.sessionId,
        userId,
        status: 'ACTIVE',
        authIdentityId: authContext.authIdentityId,
        expiresAt: { gt: now },
        OR: [
          { absoluteExpiresAt: null },
          { absoluteExpiresAt: { gt: now } },
        ],
      },
      include: {
        authIdentity: true,
      },
    });
    const identity = session?.authIdentity;
    if (
      !identity
      || identity.id !== authContext.authIdentityId
      || identity.userId !== userId
      || identity.provider !== 'WECHAT'
      || identity.verified !== true
      || identity.appId !== appId
      || typeof identity.identifier !== 'string'
      || !identity.identifier
      || identity.identifier.length > 64
    ) {
      throw new UnauthorizedException('当前会话未绑定可信的小程序微信身份');
    }
    return {
      authIdentityId: identity.id,
      appId,
      openId: identity.identifier,
    };
  }

  private assertWechatQueryMatchesWithdraw(
    withdraw: any,
    query: Extract<WechatMerchantTransferQueryResult, { outcome: 'FOUND' }>,
    notify?: WechatMerchantTransferNotify,
  ): void {
    const provider = this.resolveWechatTransferService();
    const snapshot = this.readAccountSnapshot(withdraw.accountSnapshot);
    const expectedAmountFen = yuanToCents(withdraw.netAmount);
    const trustedOpenId = query.openId ?? notify?.openId;
    const localMatches = Boolean(
      withdraw.channel === 'WECHAT'
      && withdraw.outBizNo === query.outBillNo
      && snapshot.channel === 'WECHAT'
      && snapshot.appId === provider.getMiniProgramAppId()
      && snapshot.appId === query.appId
      && snapshot.account
      && trustedOpenId
      && snapshot.account === trustedOpenId
      && query.mchId === provider.getMerchantId()
      && query.amountFen === expectedAmountFen,
    );
    const notifyMatches = !notify || Boolean(
      notify.outBillNo === query.outBillNo
      && notify.transferBillNo === query.transferBillNo
      && notify.state === query.state
      && notify.mchId === query.mchId
      && (!query.openId || notify.openId === query.openId)
      && notify.openId === snapshot.account
      && notify.amountFen === query.amountFen,
    );
    const providerOrderMatches = !withdraw.providerPayoutId
      || withdraw.providerPayoutId === query.transferBillNo;
    if (!localMatches || !notifyMatches || !providerOrderMatches) {
      throw new UnauthorizedException('微信提现订单身份或金额不匹配');
    }
  }

  private assertAlipayQueryMatchesWithdraw(
    withdraw: any,
    query: {
      outBizNo?: string;
      transAmount?: string;
      orderId?: string;
      payFundOrderId?: string;
      status: string;
    },
  ): void {
    const amount = typeof query.transAmount === 'string'
      && /^\d+(?:\.\d{1,2})?$/.test(query.transAmount)
      ? Number(query.transAmount)
      : NaN;
    const orderMatches = Boolean(
      query.orderId
      && (!withdraw.providerPayoutId || withdraw.providerPayoutId === query.orderId),
    );
    const fundOrderMatches = query.status !== 'SUCCESS' || Boolean(
      query.payFundOrderId
      && (!withdraw.providerFundOrderId || withdraw.providerFundOrderId === query.payFundOrderId),
    );
    if (
      query.outBizNo !== withdraw.outBizNo
      || !Number.isFinite(amount)
      || yuanToCents(amount) !== yuanToCents(withdraw.netAmount)
      || !orderMatches
      || !fundOrderMatches
    ) {
      throw new UnauthorizedException('支付宝提现查单身份或金额不匹配');
    }
  }

  private maskIdentifier(value: string): string {
    if (!value) return '***';
    if (value.length <= 8) return `${value.slice(0, 2)}***`;
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
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

  private resolveWechatTransferService(): WechatMerchantTransferService {
    if (!this.wechatTransferService?.isSettlementAvailable()) {
      throw new ServiceUnavailableException('微信提现结算通道配置不可用');
    }
    return this.wechatTransferService;
  }

  private resolveWechatTransferServiceForCreate(): WechatMerchantTransferService {
    if (!this.wechatTransferService?.isAvailable()) {
      throw new ServiceUnavailableException('微信提现新建通道配置不可用');
    }
    return this.wechatTransferService;
  }
}
