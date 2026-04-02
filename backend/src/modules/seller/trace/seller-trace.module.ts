import { Module } from '@nestjs/common';
import { SellerTraceController } from './seller-trace.controller';
import { SellerTraceService } from './seller-trace.service';

@Module({
  controllers: [SellerTraceController],
  providers: [SellerTraceService],
})
export class SellerTraceModule {}
