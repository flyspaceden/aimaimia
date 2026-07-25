import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  ConsumeInviteH5DownloadPassDto,
  CreateInviteH5DownloadPassDto,
} from './dto/download-pass.dto';
import { InviteH5LandingDto } from './dto/landing-event.dto';
import { InviteH5Service } from './invite-h5.service';

@Controller('invite-h5')
export class InviteH5Controller {
  constructor(private readonly inviteH5Service: InviteH5Service) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('landing')
  recordLanding(
    @Body() dto: InviteH5LandingDto,
    @Req() req: Request,
  ) {
    return this.inviteH5Service.recordLanding(dto, this.getClientIp(req));
  }

  @Get('stats')
  getStats(@CurrentUser('sub') userId: string) {
    return this.inviteH5Service.getStatsForInviter(userId);
  }

  /**
   * 微信内置浏览器已完成 H5 登录后，申请一个只用于系统浏览器下载跳转的短时凭证。
   * 凭证不包含、也不能换取买家登录 Token。
   */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('download-pass')
  createDownloadPass(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateInviteH5DownloadPassDto,
  ) {
    return this.inviteH5Service.createDownloadPass(userId, dto.landingSessionId, dto.ticket);
  }

  /** 系统浏览器原子消费下载凭证；公开但受高熵随机凭证和限流保护。 */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('download-pass/consume')
  consumeDownloadPass(@Body() dto: ConsumeInviteH5DownloadPassDto) {
    return this.inviteH5Service.consumeDownloadPass(dto.ticket);
  }

  /**
   * 微信菜单在部分安卓机型上会重新打开最初的二维码 URL，而不是当前 handoff URL。
   * 系统浏览器可用同设备短时上下文恢复下载；服务端只在唯一匹配时原子放行。
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('download-pass/resume')
  resumeDownloadPass(
    @Body() dto: InviteH5LandingDto,
    @Req() req: Request,
  ) {
    return this.inviteH5Service.resumeDownloadPass(dto, this.getClientIp(req));
  }

  private getClientIp(req: Request): string {
    // 只信任 Express 按 main.ts 的 TRUST_PROXY 解析结果，不能直接读取客户端可伪造的
    // X-Forwarded-For 首项。生产 Nginx 是唯一可信代理，req.ips[0]/req.ip 才是客户端。
    return req.ips[0] || req.ip || req.socket.remoteAddress || 'unknown';
  }
}
