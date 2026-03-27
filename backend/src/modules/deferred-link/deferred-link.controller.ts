import { Controller, Post, Get, Body, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { DeferredLinkService } from './deferred-link.service';
import { CreateDeferredLinkDto } from './dto/create-deferred-link.dto';
import { MatchDeferredLinkDto } from './dto/match-deferred-link.dto';

@Controller('deferred-link')
export class DeferredLinkController {
  constructor(private service: DeferredLinkService) {}

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @Post()
  create(@Body() dto: CreateDeferredLinkDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    return this.service.create(dto, ip);
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 20 } })
  @Get('resolve')
  resolve(@Query('cookieId') cookieId: string) {
    return this.service.resolve(cookieId);
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Post('match')
  match(@Body() dto: MatchDeferredLinkDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    return this.service.match(dto, ip);
  }
}
