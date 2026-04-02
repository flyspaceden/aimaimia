import { Module } from '@nestjs/common';
import { SellerShippingController } from './seller-shipping.controller';
import { SellerShippingService } from './seller-shipping.service';
import { SfProvider } from './providers/sf.provider';
import { YtoProvider } from './providers/yto.provider';
import { ZtoProvider } from './providers/zto.provider';
import { StoProvider } from './providers/sto.provider';
import { YundaProvider } from './providers/yunda.provider';
import { JdProvider } from './providers/jd.provider';
import { EmsProvider } from './providers/ems.provider';
import { SellerRiskControlModule } from '../risk-control/seller-risk-control.module';

@Module({
  imports: [SellerRiskControlModule],
  controllers: [SellerShippingController],
  providers: [
    SellerShippingService,
    SfProvider,
    YtoProvider,
    ZtoProvider,
    StoProvider,
    YundaProvider,
    JdProvider,
    EmsProvider,
  ],
  exports: [SellerShippingService],
})
export class SellerShippingModule {}
