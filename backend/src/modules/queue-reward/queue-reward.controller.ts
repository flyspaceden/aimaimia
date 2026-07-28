import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QueueRewardService } from './queue-reward.service';

@Controller('bonus/queue/v2')
export class QueueRewardController {
  constructor(
    private readonly queueRewardService: QueueRewardService,
  ) {}

  @Get('status')
  getStatus(
    @CurrentUser('sub') userId: string,
    @Query('afterSequence') afterSequence?: string,
    @Query('positionPageSize') positionPageSize?: string,
  ) {
    return this.queueRewardService.getUserStatus(
      userId,
      afterSequence,
      positionPageSize,
    );
  }
}
