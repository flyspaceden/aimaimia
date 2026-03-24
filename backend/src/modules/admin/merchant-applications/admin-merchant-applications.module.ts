import { Module } from '@nestjs/common';
import { AdminMerchantApplicationsController } from './admin-merchant-applications.controller';
import { AdminMerchantApplicationsService } from './admin-merchant-applications.service';

@Module({
  controllers: [AdminMerchantApplicationsController],
  providers: [AdminMerchantApplicationsService],
})
export class AdminMerchantApplicationsModule {}
