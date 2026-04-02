import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CompanyController } from './company.controller';
import { CompanyEventController } from './company-event.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [CompanyController, CompanyEventController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}
