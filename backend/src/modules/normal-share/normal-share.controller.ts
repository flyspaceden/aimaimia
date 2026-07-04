import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BindNormalShareDto } from './dto/bind-normal-share.dto';
import { CreateNormalShareDeferredDto } from './dto/create-normal-share-deferred.dto';
import { NormalShareDeferredService } from './normal-share-deferred.service';
import { NormalShareService } from './normal-share.service';

@Controller('normal-share')
export class NormalShareController {
  constructor(
    private readonly normalShareService: NormalShareService,
    private readonly deferredService: NormalShareDeferredService,
  ) {}

  @Get('me')
  getMe(@CurrentUser('sub') userId: string) {
    return this.normalShareService.getMe(userId);
  }

  @Post('bind')
  bind(
    @CurrentUser('sub') userId: string,
    @Body() dto: BindNormalShareDto,
  ) {
    return this.normalShareService.bind(userId, dto);
  }

  @Get('stats')
  getStats(@CurrentUser('sub') userId: string) {
    return this.normalShareService.getStats(userId);
  }

  @Get('records')
  getRecords(@CurrentUser('sub') userId: string) {
    return this.normalShareService.getRecords(userId);
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @Post('deferred/create')
  createDeferred(
    @Body() dto: CreateNormalShareDeferredDto,
    @Req() req: Request,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    return this.deferredService.create(dto, ip);
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 20 } })
  @Get('deferred/resolve')
  resolveDeferred(@Query('cookieId') cookieId: string) {
    return this.deferredService.resolve(cookieId);
  }
}
