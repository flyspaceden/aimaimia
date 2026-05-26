import { Controller, Get, Patch, Post, Body, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service';
import { AuthService } from '../auth/auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  SendBindPhoneCodeDto,
  BindPhoneDto,
  BindWechatDto,
} from '../auth/dto/bind.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('me')
export class UserController {
  constructor(
    private userService: UserService,
    private authService: AuthService,
  ) {}

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

  /** 头像历史（最近 5 条，按时间倒序） */
  @Get('avatar-history')
  getAvatarHistory(@CurrentUser('sub') userId: string) {
    return this.userService.getAvatarHistory(userId);
  }

  /** 发送"绑定手机号"验证码（IP 维度 3/min 防多账号同 IP 误伤；号码维度限流在 service 里） */
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('bind-phone/sms/code')
  sendBindPhoneCode(
    @CurrentUser('sub') userId: string,
    @Body() dto: SendBindPhoneCodeDto,
  ) {
    return this.authService.sendBindPhoneCode(userId, dto.phone);
  }

  /** 绑定手机号 */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('bind-phone')
  bindPhone(
    @CurrentUser('sub') userId: string,
    @Body() dto: BindPhoneDto,
  ) {
    return this.authService.bindPhone(userId, dto.phone, dto.code);
  }

  /** 绑定微信 */
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('bind-wechat')
  bindWechat(
    @CurrentUser('sub') userId: string,
    @Body() dto: BindWechatDto,
  ) {
    return this.authService.bindWechat(userId, dto.code);
  }
}
