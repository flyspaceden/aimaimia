import { Module } from '@nestjs/common';
import { BonusController } from './bonus.controller';
import { BonusService } from './bonus.service';
import { BonusConfigService } from './engine/bonus-config.service';
import { RewardCalculatorService } from './engine/reward-calculator.service';
import { NormalBroadcastService } from './engine/normal-broadcast.service';
import { VipUpstreamService } from './engine/vip-upstream.service';
import { PlatformSplitService } from './engine/platform-split.service';
import { BonusAllocationService } from './engine/bonus-allocation.service';
import { NormalUpstreamService } from './engine/normal-upstream.service';
import { NormalPlatformSplitService } from './engine/normal-platform-split.service';
import { VipPlatformSplitService } from './engine/vip-platform-split.service';
import { FreezeExpireService } from './engine/freeze-expire.service';
import { VipActivationRetryService } from './vip-activation-retry.service';
import { CouponModule } from '../coupon/coupon.module';
import { InboxModule } from '../inbox/inbox.module';
import { InfraModule } from '../../common/infra/infra.module';
import { WithdrawPayoutService } from './withdraw-payout.service';
import { WithdrawRulesService } from './withdraw-rules.service';

@Module({
  imports: [CouponModule, InboxModule, InfraModule],
  controllers: [BonusController],
  providers: [
    BonusService,
    BonusConfigService,
    RewardCalculatorService,
    NormalBroadcastService,
    VipUpstreamService,
    PlatformSplitService,
    BonusAllocationService,
    NormalUpstreamService,
    NormalPlatformSplitService,
    VipPlatformSplitService,
    FreezeExpireService,
    VipActivationRetryService,
    WithdrawRulesService,
    WithdrawPayoutService,
  ],
  exports: [BonusConfigService, BonusAllocationService, BonusService, WithdrawRulesService, WithdrawPayoutService],
})
export class BonusModule {}
