import { Module } from '@nestjs/common';
import { WechatMiniProgramApiService } from './wechat-mini-program-api.service';

@Module({
  providers: [WechatMiniProgramApiService],
  exports: [WechatMiniProgramApiService],
})
export class WechatMiniProgramPlatformModule {}
