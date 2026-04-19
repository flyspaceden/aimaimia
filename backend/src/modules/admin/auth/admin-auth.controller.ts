import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';
import {
  AdminLoginDto,
  AdminSendCodeDto,
  AdminLoginByPhoneCodeDto,
} from './dto/admin-login.dto';
import {
  AdminChangePasswordDto,
  AdminBindPhoneSmsCodeDto,
  AdminChangePhoneDto,
} from './dto/admin-account-security.dto';
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
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 20 } })
  @Get('captcha')
  async getCaptcha() {
    return this.captchaService.generate();
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('login')
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.authService.login(
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 3 } })
  @Post('sms/code')
  sendSmsCode(@Body() dto: AdminSendCodeDto, @Req() req: Request) {
    return this.authService.sendSmsCode(dto, req.ip);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
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

  // ===================== C40c7 账号安全 =====================

  /** 修改密码（已登录态，旧密码 + 新密码） */
  @Public()
  @UseGuards(AdminAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('change-password')
  changePassword(
    @CurrentAdmin('sub') adminUserId: string,
    @Body() dto: AdminChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.authService.changePassword(
      adminUserId,
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  /** 给新手机号发绑定验证码（已登录态） */
  @Public()
  @UseGuards(AdminAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 3 } })
  @Post('bind-phone/sms/code')
  sendBindPhoneSmsCode(
    @CurrentAdmin('sub') adminUserId: string,
    @Body() dto: AdminBindPhoneSmsCodeDto,
  ) {
    return this.authService.sendBindPhoneSmsCode(dto, adminUserId);
  }

  /** 修改手机号（已登录态，双重 SMS 验证） */
  @Public()
  @UseGuards(AdminAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 } })
  @Post('change-phone')
  changePhone(
    @CurrentAdmin('sub') adminUserId: string,
    @Body() dto: AdminChangePhoneDto,
    @Req() req: Request,
  ) {
    return this.authService.changePhone(
      adminUserId,
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }
}
