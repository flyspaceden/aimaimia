import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
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

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0]?.trim() || 'unknown';
    }
    return req.socket.remoteAddress || req.ip || 'unknown';
  }
}
