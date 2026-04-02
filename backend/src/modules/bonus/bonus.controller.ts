import { Controller, Get, Post, Body, Query, GoneException } from '@nestjs/common';
import { BonusService } from './bonus.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UseReferralDto } from './dto/use-referral.dto';
import { WithdrawDto } from './dto/withdraw.dto';

@Controller('bonus')
export class BonusController {
  constructor(private bonusService: BonusService) {}

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

  /** 申请提现 */
  @Post('withdraw')
  requestWithdraw(
    @CurrentUser('sub') userId: string,
    @Body() dto: WithdrawDto,
  ) {
    return this.bonusService.requestWithdraw(userId, dto);
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
