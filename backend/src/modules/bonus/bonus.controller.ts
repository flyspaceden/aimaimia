import {
  BadRequestException,
  Body,
  Controller,
  Get,
  GoneException,
  Headers,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { BonusService } from './bonus.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UseReferralDto } from './dto/use-referral.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { WithdrawPayoutService } from './withdraw-payout.service';
import { WechatMerchantTransferService } from './wechat-merchant-transfer.service';

@Controller('bonus')
export class BonusController {
  private readonly logger = new Logger(BonusController.name);

  constructor(
    private bonusService: BonusService,
    private withdrawPayoutService: WithdrawPayoutService,
    private wechatMerchantTransferService: WechatMerchantTransferService,
  ) {}

  // ========== 会员信息 ==========

  /** 会员信息 */
  @Get('member')
  getMemberProfile(@CurrentUser('sub') userId: string) {
    return this.bonusService.getMemberProfile(userId);
  }

  /** 使用推荐码 */
  @Post('referral')
  useReferralCode(
    @CurrentUser('sub') userId: string,
    @Body() dto: UseReferralDto,
  ) {
    return this.bonusService.useReferralCode(userId, dto.code);
  }

  /** 当前用户直接推荐的用户明细 */
  @Get('referral/records')
  getReferralRecords(@CurrentUser('sub') userId: string) {
    return this.bonusService.getReferralRecords(userId);
  }

  /** @deprecated 旧 VIP 直购入口已停用，统一走 VIP 礼包下单流程 */
  @Post('vip/purchase')
  purchaseVip() {
    throw new GoneException('旧 VIP 直购接口已停用，请通过 VIP 礼包完成下单与支付');
  }

  /** 获取 VIP 赠品方案列表（前台，不要求登录） */
  @Public()
  @Get('vip/gift-options')
  getVipGiftOptions() {
    return this.bonusService.getVipGiftOptions();
  }

  // ========== 奖励钱包 ==========

  /** 钱包余额 */
  @Get('wallet')
  getWallet(@CurrentUser('sub') userId: string) {
    return this.bonusService.getWallet(userId);
  }

  /** 钱包流水 */
  @Get('wallet/ledger')
  getWalletLedger(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.bonusService.getWalletLedger(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  /** 小程序微信提现页面的公开规则读模型；实际冻结时仍由服务端再次裁决。 */
  @Get('withdraw/wechat/policy')
  getWechatMiniappWithdrawPolicy() {
    return this.withdrawPayoutService.getWechatMiniappWithdrawPolicy();
  }

  /** 申请提现 */
  @Post('withdraw')
  requestWithdraw(
    @CurrentUser('sub') userId: string,
    @CurrentUser('sessionId') sessionId: string | undefined,
    @CurrentUser('authIdentityId') authIdentityId: string | undefined,
    @Body() dto: WithdrawDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new BadRequestException('Idempotency-Key header required');
    }
    return this.withdrawPayoutService.requestWithdraw(
      userId,
      dto,
      idempotencyKey.trim(),
      { sessionId, authIdentityId },
    );
  }

  /**
   * 用户关闭首次收款确认页后，必须先查询同一微信原单，
   * 只在原单仍可确认时重新下发已保存的 package_info。
   */
  @Post('withdraw/:id/wechat/confirmation')
  continueWechatWithdrawConfirmation(
    @CurrentUser('sub') userId: string,
    @CurrentUser('sessionId') sessionId: string | undefined,
    @CurrentUser('authIdentityId') authIdentityId: string | undefined,
    @Param('id') withdrawId: string,
  ) {
    return this.withdrawPayoutService.continueWechatWithdrawConfirmation(
      userId,
      withdrawId,
      { sessionId, authIdentityId },
    );
  }

  /** 微信商家转账终态通知：rawBody 验签后，再按原 outBillNo 查单完成 appid/资金身份核验。 */
  @Public()
  @Throttle({
    default: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 600 },
    user: { ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 600 },
  })
  @Post('withdraw/wechat/notify')
  async handleWechatTransferNotify(
    @Body() body: Record<string, any>,
    @Req() req: Request & { rawBody?: Buffer | string },
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() res: Response,
  ) {
    const rawBody = Buffer.isBuffer(req.rawBody)
      ? req.rawBody.toString('utf8')
      : typeof req.rawBody === 'string' && req.rawBody.length > 0
        ? req.rawBody
        : null;
    if (!rawBody) {
      res.status(401).send({ code: 'FAIL', message: '微信转账通知缺少 rawBody' });
      return;
    }

    let notify;
    try {
      const readHeader = (name: string): string | undefined => {
        const value = headers[name] ?? headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
      };
      notify = this.wechatMerchantTransferService.parseNotify({
        body,
        rawBody,
        headers: {
          signature: readHeader('wechatpay-signature'),
          timestamp: readHeader('wechatpay-timestamp'),
          nonce: readHeader('wechatpay-nonce'),
          serial: readHeader('wechatpay-serial'),
        },
      });
    } catch (error: any) {
      this.logger.warn(`微信转账通知验签或解密失败: ${error?.message || 'UNKNOWN'}`);
      res.status(401).send({ code: 'FAIL', message: '微信转账通知验证失败' });
      return;
    }

    try {
      const eventId = await this.withdrawPayoutService.enqueueWechatTransferNotify(notify);
      res.status(204).send();
      // 已验签事件先持久化再快速 ACK；异步处理失败由分钟级 inbox 重试兜底。
      void this.withdrawPayoutService.processWechatTransferNotifyInbox(eventId).catch((error: any) => {
        this.logger.error(
          `微信提现通知异步处理失败: eventId=${eventId.slice(0, 4)}*** error=${error?.message || 'UNKNOWN'}`,
        );
      });
    } catch (error: any) {
      this.logger.error(
        `微信转账通知落库失败: eventId=${notify.eventId.slice(0, 4)}*** error=${error?.message || 'UNKNOWN'}`,
      );
      res.status(500).send({ code: 'FAIL', message: '微信转账通知暂未保存' });
    }
  }

  /** 提现记录 */
  @Get('withdraw/history')
  getWithdrawHistory(@CurrentUser('sub') userId: string) {
    return this.bonusService.getWithdrawHistory(userId);
  }

  // ========== 奖励抵扣 ==========

  /** 可用奖励列表（结算页选择抵扣） */
  @Get('rewards/available')
  getAvailableRewards(@CurrentUser('sub') userId: string) {
    return this.bonusService.getAvailableRewards(userId);
  }

  // ========== VIP 三叉树 ==========

  /** VIP 三叉树数据 */
  @Get('vip/tree')
  getVipTree(@CurrentUser('sub') userId: string) {
    return this.bonusService.getVipTree(userId);
  }

  // ========== 普通用户树 ==========

  /** 普通树上下文（买家查看自己在树中的位置） */
  @Get('normal-tree/context')
  getNormalTreeContext(@CurrentUser('sub') userId: string) {
    return this.bonusService.getNormalTreeContext(userId);
  }

  /** 普通奖励钱包余额 */
  @Get('normal-wallet')
  getNormalWallet(@CurrentUser('sub') userId: string) {
    return this.bonusService.getNormalWallet(userId);
  }

  /** 普通奖励列表（含冻结状态、解锁条件、过期倒计时） */
  @Get('normal-rewards')
  getNormalRewards(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.bonusService.getNormalRewards(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  // ========== 排队队列（已废弃，保留兼容） ==========

  /** 排队状态 */
  @Get('queue/status')
  getQueueStatus(@CurrentUser('sub') userId: string) {
    return this.bonusService.getQueueStatus(userId);
  }
}
