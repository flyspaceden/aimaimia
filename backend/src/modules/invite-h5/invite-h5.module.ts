import { Module } from '@nestjs/common';
import { BonusModule } from '../bonus/bonus.module';
import { NormalShareModule } from '../normal-share/normal-share.module';
import { WechatMiniProgramPlatformModule } from '../wechat-mini-program-platform/wechat-mini-program-platform.module';
import { InviteCodeResolverService } from './invite-code-resolver.service';
import { InviteH5Controller } from './invite-h5.controller';
import { InviteH5Service } from './invite-h5.service';

@Module({
  imports: [NormalShareModule, BonusModule, WechatMiniProgramPlatformModule],
  controllers: [InviteH5Controller],
  providers: [InviteCodeResolverService, InviteH5Service],
  exports: [InviteH5Service],
})
export class InviteH5Module {}
