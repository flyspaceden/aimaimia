import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AsrService } from './asr.service';
import { ProductModule } from '../product/product.module';
import { CompanyModule } from '../company/company.module';

@Module({
  imports: [ProductModule, CompanyModule],
  controllers: [AiController],
  providers: [AiService, AsrService],
})
export class AiModule {}
