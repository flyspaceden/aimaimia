import { Module } from '@nestjs/common';
import { ShippingRuleController } from './shipping-rule.controller';
import { ShippingRuleService } from './shipping-rule.service';
import { BonusModule } from '../../bonus/bonus.module';
import { ShippingRuleCache } from './shipping-rule.cache';

@Module({
  imports: [BonusModule],
  controllers: [ShippingRuleController],
  providers: [ShippingRuleService, ShippingRuleCache],
  exports: [ShippingRuleService, ShippingRuleCache],
})
export class ShippingRuleModule {}
