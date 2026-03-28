import { Module } from '@nestjs/common';
import { SellerCompanyController } from './seller-company.controller';
import { SellerCompanyService } from './seller-company.service';
import { CompanyModule } from '../../company/company.module';

@Module({
  imports: [CompanyModule],
  controllers: [SellerCompanyController],
  providers: [SellerCompanyService],
})
export class SellerCompanyModule {}
