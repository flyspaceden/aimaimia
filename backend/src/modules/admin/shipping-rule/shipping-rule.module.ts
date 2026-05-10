import { Module } from '@nestjs/common';
import { ShippingRuleController } from './shipping-rule.controller';
import { ShippingRuleService } from './shipping-rule.service';
import { BonusModule } from '../../bonus/bonus.module';
import { ShippingRuleCache } from './shipping-rule.cache';
import { ShippingRuleImportService } from './shipping-rule-import.service';

@Module({
  imports: [BonusModule],
  controllers: [ShippingRuleController],
  providers: [ShippingRuleService, ShippingRuleCache, ShippingRuleImportService],
  exports: [ShippingRuleService, ShippingRuleCache, ShippingRuleImportService],
})
export class ShippingRuleModule {}
