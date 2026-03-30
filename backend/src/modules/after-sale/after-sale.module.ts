import { Module } from '@nestjs/common';
import { AfterSaleController } from './after-sale.controller';
import { AfterSaleService } from './after-sale.service';

@Module({
  controllers: [AfterSaleController],
  providers: [AfterSaleService],
  exports: [AfterSaleService],
})
export class AfterSaleModule {}
