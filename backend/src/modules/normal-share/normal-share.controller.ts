import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BindNormalShareDto } from './dto/bind-normal-share.dto';
import { NormalShareService } from './normal-share.service';

@Controller('normal-share')
export class NormalShareController {
  constructor(private readonly normalShareService: NormalShareService) {}

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
}
