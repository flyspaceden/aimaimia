import { Module } from '@nestjs/common';
import { AdminTraceController } from './admin-trace.controller';
import { AdminTraceService } from './admin-trace.service';

@Module({
  controllers: [AdminTraceController],
  providers: [AdminTraceService],
})
export class AdminTraceModule {}
