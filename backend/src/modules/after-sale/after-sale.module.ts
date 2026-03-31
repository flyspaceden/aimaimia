import { Module, forwardRef } from '@nestjs/common';
import { AfterSaleController } from './after-sale.controller';
import { AfterSaleService } from './after-sale.service';
import { AfterSaleRewardService } from './after-sale-reward.service';
import { AfterSaleTimeoutService } from './after-sale-timeout.service';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [forwardRef(() => PaymentModule)],
  controllers: [AfterSaleController],
  providers: [AfterSaleService, AfterSaleRewardService, AfterSaleTimeoutService],
  exports: [AfterSaleService, AfterSaleRewardService],
})
export class AfterSaleModule {}
