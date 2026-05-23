import { Controller, Get, Patch, Post, Body, BadRequestException } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('me')
export class UserController {
  constructor(private userService: UserService) {}

  @Get()
  getProfile(@CurrentUser('sub') userId: string) {
    return this.userService.getProfile(userId);
  }

  @Patch()
  updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(userId, dto);
  }

  @Post('sync-wechat-avatar')
  syncWechatAvatar(
    @CurrentUser('sub') userId: string,
    @Body() body: { code?: string },
  ) {
    if (!body?.code) {
      throw new BadRequestException('缺少 code 参数');
    }
    return this.userService.syncWechatAvatar(userId, body.code);
  }
}
