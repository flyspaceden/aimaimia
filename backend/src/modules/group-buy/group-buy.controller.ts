import { Controller, Get } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GroupBuyService } from './group-buy.service';

@Controller('group-buy')
export class GroupBuyController {
  constructor(private readonly groupBuyService: GroupBuyService) {}

  @Get('activities')
  findActiveActivities() {
    return this.groupBuyService.findActiveActivities();
  }

  @Get('me/current')
  getCurrentState(@CurrentUser('sub') userId: string) {
    return this.groupBuyService.getCurrentState(userId);
  }
}
