import { Module } from '@nestjs/common';
import { AdminCompaniesController } from './admin-companies.controller';
import { AdminCompaniesService } from './admin-companies.service';

@Module({
  controllers: [AdminCompaniesController],
  providers: [AdminCompaniesService],
})
export class AdminCompaniesModule {}
