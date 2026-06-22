import { Controller } from '@nestjs/common';

import { GroupBuyService } from './group-buy.service';

@Controller('group-buy')
export class GroupBuyController {
  constructor(private readonly groupBuyService: GroupBuyService) {}
}
