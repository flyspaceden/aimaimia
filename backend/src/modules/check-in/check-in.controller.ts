import { Controller, Get, Post, ForbiddenException } from '@nestjs/common';
import { CheckInService } from './check-in.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('check-in')
export class CheckInController {
  constructor(private checkInService: CheckInService) {}

  /** 签到状态（连续天数、今日是否签到、奖励列表） */
  @Get('status')
  getStatus(@CurrentUser('sub') userId: string) {
    return this.checkInService.getStatus(userId);
  }

  /** 执行签到（发放奖励） */
  @Post()
  checkIn(@CurrentUser('sub') userId: string) {
    return this.checkInService.checkIn(userId);
  }

  /** 重置签到（仅非生产环境可用） */
  @Post('reset')
  reset(@CurrentUser('sub') userId: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('生产环境不允许重置签到');
    }
    return this.checkInService.reset(userId);
  }
}
