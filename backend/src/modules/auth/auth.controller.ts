import { Controller, Post, Body, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SendSmsCodeDto, SendEmailCodeDto, WeChatOAuthDto } from './dto/send-code.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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
  @Throttle({ default: { ttl: 60000, limit: 1 } }) // 每 IP 每分钟 1 次
  @Post('email/code')
  sendEmailCode(@Body() dto: SendEmailCodeDto) {
    return this.authService.sendEmailCode(dto.email);
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

  @Public()
  @Post('oauth/wechat')
  loginWithWeChat(@Body() dto: WeChatOAuthDto) {
    return this.authService.loginWithWeChat(dto.code);
  }

  @Public()
  @Post('oauth/apple')
  loginWithApple() {
    return this.authService.loginWithApple();
  }
}
