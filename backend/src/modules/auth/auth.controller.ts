import { Controller, Get, Post, Body, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { InviteLoginDto } from './dto/invite-login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  H5WechatInviteLoginDto,
  H5WechatStartQueryDto,
  SendSmsCodeDto,
  WeChatOAuthDto,
} from './dto/send-code.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SendForgotPasswordCodeDto, ResetForgotPasswordDto } from './dto/forgot-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  WechatMiniappBindPhoneCodeDto,
  WechatMiniappBindPhoneDto,
  WechatMiniappLoginDto,
} from './dto/wechat-miniapp.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 买家登录：每 IP 每分钟最多 5 次（手机号维度限频另见服务层）
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('invite-login')
  inviteLogin(@Body() dto: InviteLoginDto) {
    return this.authService.inviteLogin(dto);
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 1 } }) // 每 IP 每分钟 1 次
  @Post('sms/code')
  sendSmsCode(@Body() dto: SendSmsCodeDto) {
    return this.authService.sendSmsCode(dto.phone);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('forgot-password/send-code')
  sendForgotPasswordCode(@Body() dto: SendForgotPasswordCodeDto) {
    return this.authService.sendForgotPasswordCode(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('forgot-password/reset')
  resetForgotPassword(@Body() dto: ResetForgotPasswordDto, @Req() req: Request) {
    return this.authService.resetForgotPassword(
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  logout(
    @CurrentUser('sub') userId: string,
    @Req() req: any,
  ) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.authService.logout(userId, token);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('change-password')
  changePassword(
    @CurrentUser('sub') userId: string,
    @CurrentUser('sessionId') sessionId: string | null | undefined,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto, sessionId ?? undefined);
  }

  @Public()
  @Post('oauth/wechat')
  loginWithWeChat(@Body() dto: WeChatOAuthDto) {
    return this.authService.loginWithWeChat(dto.code);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('oauth/wechat-miniapp')
  loginWithWechatMiniapp(@Body() dto: WechatMiniappLoginDto) {
    return this.authService.loginWithWechatMiniapp(dto.code);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('oauth/wechat-miniapp/bind-phone/sms/code')
  sendWechatMiniappBindPhoneCode(@Body() dto: WechatMiniappBindPhoneCodeDto) {
    return this.authService.sendWechatMiniappBindPhoneCode(
      dto.miniLoginTicket,
      dto.phone,
    );
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('oauth/wechat-miniapp/bind-phone')
  bindWechatMiniappPhone(@Body() dto: WechatMiniappBindPhoneDto) {
    return this.authService.bindWechatMiniappPhone(
      dto.miniLoginTicket,
      dto.phone,
      dto.code,
    );
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('h5-wechat/start')
  async startH5WechatLogin(@Query() dto: H5WechatStartQueryDto, @Res() res: Response) {
    return res.redirect(await this.authService.buildH5WechatAuthUrl(dto));
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('h5-wechat/invite-login')
  h5WechatInviteLogin(@Body() dto: H5WechatInviteLoginDto) {
    return this.authService.h5WechatInviteLogin(dto);
  }

  @Public()
  @Post('oauth/apple')
  loginWithApple() {
    return this.authService.loginWithApple();
  }
}
