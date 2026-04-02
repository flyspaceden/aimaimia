import { Module } from '@nestjs/common';
import { VirtualCallController } from './virtual-call.controller';
import { VirtualCallService } from './virtual-call.service';
import { MockVirtualCallProvider } from './mock-virtual-call.provider';
import { VIRTUAL_CALL_PROVIDER } from './virtual-call-provider.interface';
import { CallKeywordDetectorService } from './call-keyword-detector.service';
import { SellerRiskControlModule } from '../risk-control/seller-risk-control.module';

@Module({
  imports: [SellerRiskControlModule],
  controllers: [VirtualCallController],
  providers: [
    VirtualCallService,
    CallKeywordDetectorService,
    {
      provide: VIRTUAL_CALL_PROVIDER,
      useClass: MockVirtualCallProvider,
    },
  ],
  exports: [VirtualCallService, CallKeywordDetectorService],
})
export class VirtualCallModule {}
