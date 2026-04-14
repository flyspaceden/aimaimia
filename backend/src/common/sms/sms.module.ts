import { Global, Module } from '@nestjs/common';
import { AliyunSmsService } from './aliyun-sms.service';

/**
 * 短信服务模块（全局）
 *
 * 提供 AliyunSmsService，在 AppModule 中导入后全局可用，
 * 各模块无需单独 import 即可注入使用。
 */
@Global()
@Module({
  providers: [AliyunSmsService],
  exports: [AliyunSmsService],
})
export class SmsModule {}
