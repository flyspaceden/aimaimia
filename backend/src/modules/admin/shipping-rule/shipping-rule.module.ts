import { Module } from '@nestjs/common';
import { ShippingRuleController } from './shipping-rule.controller';
import { ShippingRuleService } from './shipping-rule.service';
import { BonusModule } from '../../bonus/bonus.module';

@Module({
  imports: [BonusModule],
  controllers: [ShippingRuleController],
  providers: [ShippingRuleService],
  exports: [ShippingRuleService],
})
export class ShippingRuleModule {}
