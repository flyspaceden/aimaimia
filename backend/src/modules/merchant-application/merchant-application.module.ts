import { Module } from '@nestjs/common';
import { CaptchaModule } from '../captcha/captcha.module';
import { UploadModule } from '../upload/upload.module';
import { MerchantApplicationController } from './merchant-application.controller';
import { MerchantApplicationService } from './merchant-application.service';

@Module({
  imports: [CaptchaModule, UploadModule],
  controllers: [MerchantApplicationController],
  providers: [MerchantApplicationService],
})
export class MerchantApplicationModule {}
