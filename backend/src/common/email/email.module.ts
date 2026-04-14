import { Global, Module } from '@nestjs/common';
import { AliyunEmailService } from './aliyun-email.service';

/**
 * 邮件服务模块（全局）
 *
 * 提供 AliyunEmailService，在 AppModule 中导入后全局可用，
 * 各模块无需单独 import 即可注入使用。
 */
@Global()
@Module({
  providers: [AliyunEmailService],
  exports: [AliyunEmailService],
})
export class EmailModule {}
