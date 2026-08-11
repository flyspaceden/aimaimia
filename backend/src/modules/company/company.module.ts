import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CompanyController } from './company.controller';
import { CompanyEventController } from './company-event.controller';
import { CompanyService } from './company.service';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [JwtModule.register({}), UploadModule],
  controllers: [CompanyController, CompanyEventController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}
