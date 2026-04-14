import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';
import {
  AdminLoginDto,
  AdminSendCodeDto,
  AdminLoginByPhoneCodeDto,
} from './dto/admin-login.dto';
import { AdminRefreshDto } from './dto/admin-refresh.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { CurrentAdmin } from '../common/decorators/current-admin';
import { CaptchaService } from '../../captcha/captcha.service';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private authService: AdminAuthService,
    private captchaService: CaptchaService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Get('captcha')
  async getCaptcha() {
    return this.captchaService.generate();
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 每 IP 每分钟最多 5 次登录尝试
  @Post('login')
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.authService.login(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('sms/code')
  sendSmsCode(@Body() dto: AdminSendCodeDto) {
    return this.authService.sendSmsCode(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login-by-phone-code')
  loginByPhoneCode(
    @Body() dto: AdminLoginByPhoneCodeDto,
    @Req() req: Request,
  ) {
    return this.authService.loginByPhoneCode(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: AdminRefreshDto) {
    return this.authService.refresh(dto);
  }

  @Public()
  @UseGuards(AdminAuthGuard)
  @Post('logout')
  logout(@CurrentAdmin('sub') adminUserId: string, @Req() req: Request) {
    return this.authService.logout(
      adminUserId,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Public()
  @UseGuards(AdminAuthGuard)
  @Get('profile')
  getProfile(@CurrentAdmin('sub') adminUserId: string) {
    return this.authService.getProfile(adminUserId);
  }
}
