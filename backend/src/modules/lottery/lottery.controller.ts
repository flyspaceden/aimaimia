import { Controller, Get, Post, Body, Req, Query } from '@nestjs/common';
import { LotteryService } from './lottery.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PublicDrawDto } from './dto/public-draw.dto';

@Controller('lottery')
export class LotteryController {
  constructor(private lotteryService: LotteryService) {}

  /** 抽奖（每日一次，需登录） */
  @Post('draw')
  draw(@CurrentUser('sub') userId: string) {
    return this.lotteryService.draw(userId);
  }

  /** 今日抽奖状态（未登录返回默认状态） */
  @Public()
  @Get('today')
  todayStatus(@CurrentUser('sub') userId?: string) {
    if (!userId) {
      return { hasDrawn: false, remainingChances: 1, records: [] };
    }
    return this.lotteryService.getTodayStatus(userId);
  }

  /** 奖池列表（公开，转盘展示） */
  @Public()
  @Get('prizes')
  prizes() {
    return this.lotteryService.getPrizes();
  }

  /** 公开抽奖（无需登录，设备指纹 + IP 限流） */
  @Public()
  @Post('public/draw')
  publicDraw(@Body() dto: PublicDrawDto, @Req() req: any) {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    return this.lotteryService.publicDraw(dto.deviceFingerprint, clientIp);
  }

  /** 公开今日抽奖状态（无需登录） */
  @Public()
  @Get('public/today')
  publicTodayStatus(@Query('fp') fp: string) {
    return this.lotteryService.getPublicTodayStatus(fp);
  }
}
